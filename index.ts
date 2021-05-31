import config from 'config';
import ffmpeg, { FfmpegCommand } from 'fluent-ffmpeg';
import winston, { stream, verbose } from 'winston';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import cliProgress from 'cli-progress';
import path from 'path';

import {Stage} from 'types/Stage';
import { StageResult } from 'types/StageResult';
import { Person } from 'types/Person';
import { MatchResult } from 'types/MatchResult';
import { getTextPositionValue, TextOverlayConfig } from 'types/TextOverlayConfig';
import { VideoConfig } from 'types/VideoConfig';

const logger = winston.createLogger({
    level: config.get("logger.level"),
    format: winston.format.combine(
        winston.format.simple(),
        winston.format.colorize()
    ),
    transports: [
        new winston.transports.File({filename:`${config.get('report.baseDir')}/debug.txt`})
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


function buildVideo(videoList: string[]) {
    logger.info("Building videorenderer");
    return async function(results: {overall: MatchResult, division: MatchResult, stages: Stage[]}) {
        logger.info("Preparing video");
    }    
}

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

const merge = ffmpeg();
let workers:any[] = [];
let videos:[] = config.get('report.video');

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
    workers.push(videoGenTitle( path, duration, config.get('report.title.text'), opt, videoOpt, progressBars));
    merge.input(path);
}

for(const video of videos) {
    let videoConfig:VideoConfig;
    if(typeof video == 'object'){
        videoConfig = {
            path: config.get('report.baseDir') + '/' + video['path'],
        };

        if(video['begin']){
            videoConfig.begin = video['begin'];
        }

        if(video['end']){
            videoConfig.end = video['end']
        }

        if(typeof video['subtitle'] == 'object'){
            videoConfig.subtitle = video['subtitle'] as TextOverlayConfig;
            videoConfig.text = video['text'];
        }
    } else {
        videoConfig = {
            path: config.get('report.baseDir') + '/' + video
        }
    }

    const command = ffmpeg(videoConfig.path);
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
    const resultPath:string = videoConfig.path + '.resized.mov';
    merge.input(resultPath);

    if(videoConfig.subtitle && videoConfig.text){
        filters.push(videoAddOverlay(`${output}`, 'ov', videoConfig.text, videoConfig.subtitle));
        output = 'ov';
    }
    command.complexFilter(filters, output);
    command.addOption('-map 0:a');

    const progressBar = progressBars.create(100, 0);
    const pCommand:Promise<string>= new Promise((resolve, reject) => {
        command
            .on('start', (commandString) => {
                logger.debug(`Starting task ${commandString}`);
                progressBar.start(100, 0, {file:path.basename(videoConfig.path)});
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

    workers.push(pCommand);
}

Promise.all(workers).then(async (paths):Promise<string[]> => {
    const {transitions, outputs} = await prepareTransitionFilters(paths, config.has('report.fade.type') ? config.get('report.fade.type') : undefined);
    
    const mergingBar = progressBars.create(100, 0);
    merge.complexFilter(transitions, outputs);
    return new Promise((resolve, reject) => {
        merge
            .on('start', (cli) => {
                logger.debug(`Merging with command ${cli}`);
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
            .on('error', (e) => {throw new Error(e)})
            .output(config.get('report.baseDir') + '/result.mov')
            .run()
    })
})
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

async function removeFiles(paths:string[]){
    const tasks = paths.map((path) => fs.unlink(path));
    await Promise.all(tasks);
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
    return {
            filter: 'drawtext',
            options: {
                fontsize: textConfig.font.size,
                fontcolor: textConfig.font.color,
                x: getTextPositionValue(textConfig.position, "x"),
                y: getTextPositionValue(textConfig.position, "y"),
                text: encodeTitle(text)
            },
            inputs,
            outputs
        };
}

function videoGenTitle(outPath: string, duration: number, text: string, textConfig: TextOverlayConfig, videoConfig: any, progressBarsManager:cliProgress.MultiBar) {
    const command = genEmptyVideoCommand(videoConfig, duration);
    command.complexFilter([
        videoAddOverlay('0', 'ov', text, textConfig),
    ], 'ov');

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
                    penalties: personResult.penalties
                }
            });
        })
    });

    matchDef.match_stages.forEach((stageData:any) => {
        if(!stageResults[stageData.stage_uuid]){
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
        stages: stageList
    }; 
}

function encodeTitle(title:string):string{
    title = title.replace(/\\/g, '\\\\\\\\');
    title = title.replace(/\%/g, '\\\\%');
    title = title.replace(/\:/g, '\\:');
    title = title.replace(/\'/g, "'\\\\\\''");
    title = `'${title}'`;
    return title;
}