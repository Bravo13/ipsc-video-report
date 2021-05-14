import config from 'config';
import ffmpeg, { FfmpegCommand } from 'fluent-ffmpeg';
import winston from 'winston';
import fetch from 'node-fetch';

import {Stage} from 'types/Stage';
import { StageResult } from 'types/StageResult';
import { Person } from 'types/Person';
import { MatchResult } from 'types/MatchResult';
import { getTextPositionValue, TextOverlayConfig } from 'types/TextOverlayConfig';

const logger = winston.createLogger({
    level: config.get("logger.level"),
    format: winston.format.combine(
        winston.format.simple(),
        winston.format.colorize()
    ),
    transports: [
        new winston.transports.Console()
    ]
})

logger.info("Started");

function buildVideo(videoList: string[]) {
    logger.info("Building videorenderer");
    return async function(results: {overall: MatchResult, division: MatchResult, stages: Stage[]}) {
        logger.info("Preparing video");
    }    
}

function videoGenTitle(path: string, duration: number, text: string, textConfig: TextOverlayConfig, videoConfig: any) {
    const command = ffmpeg('color=black:size='+videoConfig.size+':rate='+videoConfig.rate+':duration='+duration).inputFormat('lavfi');
    command.complexFilter([
        {
            filter: 'drawtext',
            options: {
                fontsize: textConfig.font.size,
                fontcolor: textConfig.font.color,
                x: getTextPositionValue(textConfig.position, "x"),
                y: getTextPositionValue(textConfig.position, "y"),
                text
            },
        }
    ]);

    return new Promise((resolve, reject) => {
        command
            .output(path)
            .on('start', (commandString) => console.log(`starting ${commandString}`))
            .on('error', (e) => reject(e))
            .on('end', () => resolve(path))
            .run();
    })
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