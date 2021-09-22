import config from 'config';
import ffmpeg, { FfmpegCommand, FilterSpecification } from 'fluent-ffmpeg';
import winston, { exitOnError, stream, verbose } from 'winston';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import cliProgress from 'cli-progress';
import path from 'path';
import dot from 'dot';

import {Stage} from 'types/Stage';
import { StageResult, Score, ScorePaper, ScoreSteel, ScorePenalties } from 'types/StageResult';
import { Person } from 'types/Person';
import { MatchResult } from 'types/MatchResult';
import { getTextPositionValue, TextOverlayConfig } from 'types/TextOverlayConfig';
import { VideoConfig } from 'types/VideoConfig';
import { parseCommandLine } from 'typescript';
import { calcScore } from 'libs/paperScoreMagic';

const logger = winston.createLogger({
    level: config.get("logger.level"),
    format: winston.format.combine(
        winston.format.simple(),
        winston.format.colorize(),
        winston.format.errors({stack: true})
    ),
    transports: [
        new winston.transports.File({filename:`${config.get('report.baseDir')}/debug.txt`}),
        new winston.transports.Console()
    ]
})

logger.info("Started");

if(config.has("ffmpeg.path")){
    logger.info(`Using custom ffmpeg path ${config.get("ffmpeg.path")}`);
    process.env.FFMPEG_PATH = config.get("ffmpeg.path");
}

/*
fetchResults(config.get("report.results"))
    .then(buildVideo(config.get("report.video") as string[]))
    .catch((e) => logger.error(e));
*/

const videoOpt = {
    size: `${config.get('report.size.w')}x${config.get('report.size.h')}`,
    width: config.get('report.size.w'),
    height: config.get('report.size.h'),
    rate: config.get('report.rate')
}

let progressBarFormat = cliProgress.Presets.rect;
progressBarFormat.format = '{file} {percentage}% {frames}';
let progressBars = new cliProgress.MultiBar({
    clearOnComplete: false,
    hideCursor: true,
    linewrap: false
}, progressBarFormat);

let pathsToMerge:any[] = [];
let videos:[] = config.get('report.video');

let emptyCounter = 0;
(async () => {

    let matchResultTexts: string[] = [];
    let videoTitle:string = config.has('report.title.text') ? config.get('report.title.text') : '';
    if(config.has('report.results')){
        const matchResults = await fetchResults(config.get('report.results'));
        for(let result of matchResults.stages)
            matchResultTexts.push(stageResultToOutput(result, config.get('report.results-template')));

        videoTitle = renderTitle(matchResults, config.get('report.title-template'));
    }

    if(config.get('report.type') == 'general'){
        const opt:TextOverlayConfig = {
            font: {
                color: config.get('report.title.color'),
                name: config.get('report.title.font'),
                size: config.get('report.title.size'),
            },
            position: config.get('report.title.position')
        };
        const path = config.get('report.baseDir') + '/' + 'title.mov';
        const duration:number = config.get('report.title.duration');
        await videoGenTitle( path, duration, videoTitle, opt, videoOpt, progressBars).catch(errorHandler);
        const pathWithFadeOut = path + '.fadeOut.mov';
        const titleFadeOutCommand = await applyFadeOutFilter(path);
        await execFFmpegCommand(titleFadeOutCommand, pathWithFadeOut);
        pathsToMerge.push(pathWithFadeOut);
    }

    let index = 0;
    for(const video of videos) {
        let videoConfig:VideoConfig;
        if(typeof video == 'object'){
            videoConfig = {
                type: video['type'] ? video['type'] : 'regular',
                path: config.get('report.baseDir') + '/' + video['path'],
            };

            if(video['begin']){
                videoConfig.begin = video['begin'];
            }

            if(video['end']){
                videoConfig.end = video['end']
            }

            if(
                (typeof video['subtitle'] == 'object')
                || (
                    config.get('report.defaultSubtitleConfig')
                    && matchResultTexts[index]
                )
            ){
                videoConfig.subtitle = (video['subtitle'] ? video['subtitle'] : config.get('report.defaultSubtitleConfig')) as TextOverlayConfig;
                videoConfig.text = matchResultTexts[index] ? matchResultTexts[index] : video['text'];
            }
        } else {
            videoConfig = {
                type: 'regular',
                path: config.get('report.baseDir') + '/' + video
            }

            if(
                config.get('report.defaultSubtitleConfig')
                && matchResultTexts[index]
            ) {
                videoConfig.subtitle = config.get('report.defaultSubtitleConfig') as TextOverlayConfig;
                videoConfig.text = matchResultTexts[index];
            }
        }

        const command = videoConfig.type == 'empty' ? genEmptyVideoCommand(videoOpt, video['duration']) : ffmpeg(videoConfig.path);

        let resultPath:string = '';
        if(videoConfig.type == 'regular'){
            if(videoConfig.begin){
                command.seekOutput(videoConfig.begin);
            }

            if(videoConfig.end){
                command.setDuration(videoConfig.end-(videoConfig.begin ? videoConfig.begin : 0))
            }

            let output = 'sc'
            let filters:ffmpeg.FilterSpecification[] = [
                {
                    filter:'scale',
                    options: {
                        w:videoOpt.width,
                        h:videoOpt.height,
                        force_original_aspect_ratio: 'decrease'
                    },
                    inputs: '0:v',
                    outputs: output
                }
            ]
            command.fps(videoOpt.rate as number).audioCodec('copy');
            resultPath = videoConfig.path + '.resized.mov';

            if(videoConfig.subtitle && videoConfig.text){
                filters = filters.concat(videoAddOverlay(`${output}`, 'ov', videoConfig.text, videoConfig.subtitle));
                output = 'ov';
            }
            command.complexFilter(filters, output);
            command.addOption('-map 0:a');
        }

        if(videoConfig.type == 'empty'){
            resultPath = config.get('report.baseDir') + `/empty${emptyCounter++}.mov`;
            if(videoConfig.subtitle && videoConfig.text)
                command.complexFilter(videoAddOverlay(`0`, 'ov', videoConfig.text, videoConfig.subtitle), 'ov');
        }

        let lastPath = await execFFmpegCommand(command, resultPath);

        if(index >= 0){
            let fadeInCommand = await applyFadeInFilter(lastPath);
            lastPath = lastPath+'.fadeIn.mov';
            await execFFmpegCommand(fadeInCommand, lastPath);
        }

        if(index < videos.length-1){
            let fadeOutCommand = await applyFadeOutFilter(lastPath);
            lastPath = lastPath + '.fadeOut.mov';
            await execFFmpegCommand(fadeOutCommand, lastPath);
        }

        pathsToMerge.push(lastPath);
        index++;
    }

    await mergeVideosFromPaths(pathsToMerge)
    // Removing temporary files
    .then((paths) => {
        if(!logger.isLevelEnabled('debug')){
            removeFiles(paths)
        }
    })
    .then(() => {
        logger.info("Finished")
    })
    .catch((e) => {
        console.error('ERROR', e);
    })
    .finally(() => {
        progressBars.stop();
    })
})()

function errorHandler(ex: any){
    console.error(ex);
    process.exit();
}

async function mergeVideosFromPaths(paths: string[]):Promise<string[]> {
    const merge = ffmpeg();
    let concatInputs = '';
    paths.forEach((path, index) => {
        concatInputs += `[${index}:v:0][${index}:a:0]`;
        merge.input(path);
    });

    const outIndex = paths.length;

    concatInputs += `concat=n=${outIndex}:v=1:a=1[v${outIndex}][a${outIndex}]`;
    
    const mergingBar = progressBars.create(100, 0);
    merge.complexFilter(concatInputs, [`v${outIndex}`, `a${outIndex}`]);
    return new Promise((resolve, reject) => {
        merge
            .on('start', (cli) => {
                const pathPrefix = config.has("ffmpeg.path") ? path.dirname(config.get('ffmpeg.path'))+'/' : '';
                logger.debug(`Merging with command ${pathPrefix}${cli}`);
                mergingBar.start(100, 0, {file:"Merging"});
            })
            .on('end', () => {
                console.log('End merging');
                mergingBar.update(100);
                resolve(paths);
            })
            .on('progress', (p) => {
                mergingBar.update(p.percent, {frames:p.frames});
            })
            .on('error', (e) => reject(e))
            .output(config.get('report.baseDir') + '/result.mov')
            .run()
    })

}

async function execFFmpegCommand(command: FfmpegCommand, resultPath: string):Promise<string> {
    const progressBar = progressBars.create(100, 0);
    return new Promise((resolve, reject) => {
        command
            .on('start', (cli) => {
                const pathPrefix = config.has("ffmpeg.path") ? path.dirname(config.get('ffmpeg.path'))+'/' : '';
                logger.debug(`Starting task ${pathPrefix}${cli}`);
                progressBar.start(100, 0, {file:path.basename(resultPath)});
            })
            .on('error', (e) => reject(e))
            .on('progress', (p) => {
                progressBar.update(p.percent, {frames:p.frames});
            })
            .on('end', () => {
                progressBar.update(100);
                resolve(resultPath);
            })
            .output(resultPath)
            .run()
    })
}

async function removeFiles(paths:string[]){
    const tasks = paths.map((path) => fs.unlink(path));
    await Promise.all(tasks);
}

async function applyFadeInFilter(path: string, fadetype?:string): Promise<ffmpeg.FfmpegCommand> {
    const command = ffmpeg(path);
    const fadeDuration:number = config.get('report.fade.duration') as number / 2;

    const vFadeIn:FilterSpecification = {
        filter: 'fade',
        options: {
            type: 'in',
            color: 'white',
            duration: fadeDuration,
        }
    };

    const aFadeIn:FilterSpecification = {
        filter: 'afade',
        options: {
            type: 'in',
            duration: fadeDuration,
        }
    }

    command.complexFilter([vFadeIn, aFadeIn]);
    return command;
}

async function applyFadeOutFilter(path: string, fadetype?:string): Promise<ffmpeg.FfmpegCommand> {
    const command = ffmpeg(path);

    const meta:ffmpeg.FfprobeFormat = await getVideoMeta(path);
    const duration = meta.format.duration;
    const fadeDuration:number = config.get('report.fade.duration') as number / 2;

    const vFadeOut:FilterSpecification = {
        filter: 'fade',
        options: {
            type: 'out',
            color: 'white',
            start_time: duration - fadeDuration,
            duration: fadeDuration,
        }
    };

    const aFadeOut:FilterSpecification = {
        filter: 'afade',
        options: {
            type: 'out',
            start_time: duration - fadeDuration,
            duration: fadeDuration,
        }
    }

    command.complexFilter([vFadeOut, aFadeOut]);
    return command;
}

async function prepareTransitionFilters(paths: string[], fadetype?:string) {
    let index = 0;
    let videoTransitions:ffmpeg.FilterSpecification[] = [];
    let audioTransitions:ffmpeg.FilterSpecification[] = [];
    let lastVideoOutput = '0';
    let lastAudioOutput = '0:a';
    let lastXfadeOffset =  0;
    for(const path of paths.slice(0, -1)){
        const meta:ffmpeg.FfprobeFormat = await getVideoMeta(path);
        const duration = meta.format.duration;
        const xfadeDuration:number = config.get('report.fade.duration');
        lastXfadeOffset = duration + lastXfadeOffset - xfadeDuration;
        lastXfadeOffset = +lastXfadeOffset.toFixed(2);
        videoTransitions.push({
            filter: 'xfade',
            options: {
                transition: fadetype ? fadetype : 'fade',
                duration: config.get('report.fade.duration'),
                offset: lastXfadeOffset
            },
            inputs: [`${lastVideoOutput}`, `${index+1}:v`],
            outputs: `v${index+1}`
        });
        lastVideoOutput = `v${index+1}`;

        // Audio crossfade
        audioTransitions.push({
            filter:'acrossfade',
            options: {
                duration: config.get('report.fade.duration'),
                curve1: "exp",
                curve2: "exp"
            },
            inputs:[`${lastAudioOutput}`, `${index+1}:a`],
            outputs: `a${index+1}`
        })
        lastAudioOutput = `a${index+1}`;
        index++;
    }
    return {
        transitions: videoTransitions.concat(audioTransitions),
        outputs: [lastVideoOutput, lastAudioOutput]
    };
}

async function getVideoMeta(path: string):Promise<ffmpeg.FfprobeFormat> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(path, (err, meta) => {
            if(err)
                reject(err)
            else
                resolve(meta)
        })
    })
}

function videoAddOverlay(inputs: string | string[], outputs: string | string[], text:string, textConfig: TextOverlayConfig) {
    const lines = text.split('\n');
    let commands:FilterSpecification[] = [];
    let tOutput = 'tout0';
    lines.forEach( (line, index) => {
        const x = getTextPositionValue(textConfig.position, "x", index, lines.length, textConfig.font.size);
        const y = getTextPositionValue(textConfig.position, "y", index, lines.length, textConfig.font.size);

        const command:FilterSpecification = {
            filter: 'drawtext',
            options: {
                fontsize: textConfig.font.size,
                fontcolor: textConfig.font.color,
                x,
                y,
                text: encodeTitle(line),
                expansion: "normal"
            },
        };
        if(index == 0)
            command.inputs = inputs;
        else
            command.inputs = tOutput;
        
        if(index == lines.length-1)
            command.outputs = outputs;
        else {
            tOutput = 'tout'+index;
            command.outputs = tOutput;
        }

        commands.push(command);
    });
    return commands;
}

function videoGenTitle(outPath: string, duration: number, text: string, textConfig: TextOverlayConfig, videoConfig: any, progressBarsManager:cliProgress.MultiBar) {
    const command = genEmptyVideoCommand(videoConfig, duration);
    command.complexFilter( videoAddOverlay('0', 'ov', text, textConfig), 'ov');

    const progressBar = progressBarsManager.create(100, 0);
    return new Promise((resolve, reject) => {
        command
            .output(outPath)
            .on('start', (commandString) => {
                progressBar.start(100, 0, {file:path.basename(outPath)});
            })
            .on('progress', (p) => {
                progressBar.update(p.percent, {frames:p.frames});
            })
            .on('error', (e) => reject(e))
            .on('end', () => {
                progressBar.update(100);
                resolve(outPath)
            })
            .run();
    })
}

function genEmptyVideoCommand(videoConfig:any, duration:number):FfmpegCommand {
    const command = ffmpeg('color=black:size='+videoConfig.size+':rate='+videoConfig.rate+':duration='+duration)
    command.inputFormat('lavfi');
    command.input('anullsrc=channel_layout=stereo:sample_rate=44100')
    command.inputFormat('lavfi');
    command.outputOption('-shortest')
    command.outputOption('-map 1:a')
    return command;
}

async function fetchResults(url:string){
    const result = [...url.matchAll(/(\w{8}-\w{4}-\w{4}-\w{4}-\w{12})/g)];
    if(result.length != 2){
        throw Error("Incorrect results url. MathId on personId not found");
    }

    const matchId = result[0][0];
    const personId = result[1][0];
    
    const baseUrl = "https://s3.amazonaws.com/ps-scores/production/"+matchId;

    const jsonUrls = [
        baseUrl + '/results.json',
        baseUrl + '/match_scores.json',
        baseUrl + '/match_def.json'
    ]

    let matchDivisionResult: MatchResult;
    let matchOverallResult: MatchResult;

    let stageList:Stage[] = [];
    const [results, matchScore, matchDef] = await Promise.all(jsonUrls.map(url => fetch(url).then(resp => resp.json())));

    let person:Person;
    if(!matchDef.match_shooters){
        throw new Error("No shooters data in matchDef.json");
    }

    let personData = matchDef.match_shooters.find((data:any) => data.sh_uuid == personId);
    if(!personData){
        throw new Error(`Unable to find person data for uuid ${personId}`);
    } else {
        person = {
            division: personData.sh_dvp,
            firstName: personData.sh_fn,
            lastName: personData.sh_ln,
            id: personId
        }
    }

    if(!matchDef.match_stages) {
        throw Error("No stages data in matchDef.json");
    }

    if(
        results[0]
        && results[0]['Match']
    ) {
        const matchResults = results[0]['Match'].find((obj:any) => obj[person.division]);
        const overallResults = results[0]['Match'].find((obj:any) => obj['Overall']);

        if(!matchResults){
            throw new Error("Unable to find match results for person division");
        }

        const matchResultData = matchResults[person.division].find((res:any) => res.shooter == person.id);
        if(!matchResultData){
            throw new Error("Unable to find math result for person in division list");
        } else {
            matchDivisionResult = {
                percent: matchResultData.matchPercent,
                person: person,
                place: matchResultData.pscPlace,
                points: matchResultData.matchPoints
            }
        }

        if(!overallResults){
            throw new Error("Unable to find overall match results for person");
        }

        const overallResultData = overallResults['Overall'].find((res:any) => res.shooter == person.id);
        if(!overallResultData){
            throw new Error("Unable to find math result for person in division list");
        } else {
            matchOverallResult = {
                percent: overallResultData.matchPercent,
                person: person,
                place: overallResultData.pscPlace,
                points: overallResultData.matchPoints
            }
        }
    } else {
        throw new Error("Something went wrong with getting match result");
    }

    let stageResults: {[key: string]: StageResult} = {};
    Object.keys(results).forEach((resultKey:any) => {
        const result = results[resultKey];
        if(!result.stageUUID) return;

        // Now we need retrieve key of result... why the hell they didn't 
        // name it in some easy way???
        let stageResultKey = Object.keys(result).find(key => key != 'stageUUID');
        if(!stageResultKey){
            throw new Error("Unable to find key for results");
        }

        const stageScore = matchScore.match_scores.find((sc: any) => sc.stage_uuid == result.stageUUID);
        const stageShooterScore = stageScore.stage_stagescores.find((sc: any) => sc.shtr == person.id);

        result[stageResultKey].forEach((divisionResult:any) => {
            if(!divisionResult[person.division]) return;
            divisionResult[person.division].forEach((personResult:any) => {
                if(personResult.shooter != person.id) return;
                stageResults[result.stageUUID] = {
                    hitFactor: personResult.hitFactor,
                    person: person,
                    points: personResult.points,
                    stagePoints: personResult.stagePoints,
                    stagePercent: personResult.stagePercent,
                    time: personResult.stageTimeSecs,
                    divisionPlace: personResult.place,
                    score: buildStageScore(stageShooterScore),
                }
            });
        })
    });

    matchDef.match_stages.forEach((stageData:any) => {
        if(!stageResults[stageData.stage_uuid] && !stageData.stage_deleted){
            throw new Error(`Unable to find stage results for stage with uuid ${stageData.stage_uuid}`);
        }
        let stage:Stage = {
            maxPoints: stageData.stage_tppoints,
            title: stageData.stage_name,
            result: stageResults[stageData.stage_uuid]
        }

        stageList.push(stage);
    })
    return {
        division: matchDivisionResult,
        overall: matchOverallResult,
        stages: stageList,
        title: matchDef.match_name,
        date: matchDef.match_date
    }; 
}

function buildStageScore(stageScore: any): Score {
    let paperScore;
    if(stageScore["ts"] && stageScore["ts"].length){
        paperScore = calcScore(stageScore["ts"]);
    }

    let steelScore: ScoreSteel = {
        hits: stageScore.poph,
        misses: stageScore.popm,
        noPenaltieMisses: stageScore.popnpm,
        noShoots: stageScore.popns
    }

    let penalties;
    if(
        (
            paperScore
            && (
                paperScore.misses
                || paperScore.noPenaltieMisses
                || paperScore.noShoots
            )
        ) || (
            steelScore.misses
            || steelScore.noPenaltieMisses
            || steelScore.noShoots
        )
    ) {
        penalties = {
            misses: (paperScore && paperScore.misses ? paperScore.misses : 0) + (steelScore.misses ? steelScore.misses : 0),
            noPenaltieMisses: (paperScore && paperScore.noPenaltieMisses) ? paperScore.noPenaltieMisses : 0 + (steelScore.noPenaltieMisses ? steelScore.noPenaltieMisses : 0),
            noShoots: (paperScore && paperScore.noShoots) ? paperScore.noShoots : 0 + (steelScore.noShoots ? steelScore.noShoots : 0)
        } as ScorePenalties;
    }

    let score:Score = {
        paper: paperScore,
        steel: steelScore,
        additionalPenalties: stageScore.apen,
        procedures: stageScore.proc,
        penalties
    }
    return score;
}

function renderTitle(results: any, template: string): string{
    dot.templateSettings.strip = false;
    const tmpl = dot.template(template);
    return tmpl(results);
}

function stageResultToOutput(stageResult: Stage, template: string) {
    dot.templateSettings.strip = false;
    const tmpl = dot.template(template);
    return tmpl(stageResult);
}

function encodeTitle(title:string):string {
    title = title.replace(/\\/g, '\\\\\\\\');
    title = title.replace(/\%/g, '\\\\%');
    title = title.replace(/\:/g, '\\:');
    title = title.replace(/\'/g, "'\\\\\\''");

    // fluent-ffmpeg wraps lines if it contains comma
    if(!title.match(/[,]/))
        title = `'${title}'`;
    return title;
}