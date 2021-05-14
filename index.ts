import config from 'config';
import ffmpeg from 'fluent-ffmpeg';
import winston from 'winston';
import fetch from 'node-fetch';

import {Stage} from 'types/Stage';
import { StageResult } from 'types/StageResult';
import { Person } from 'types/Person';

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

fetchResults(config.get("report.results"))
    .then(buildVideo(config.get("report.video") as string[]))
    .catch((e) => logger.error(e));

function buildVideo(videoList: string[]) {
    logger.info("Building videorenderer");
    return async function(results: Stage[]) {
        console.log(results);
        logger.info("Preparing video");
    }    
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
                    time: personResult.stageTimeSec,
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
    return stageList; 
}