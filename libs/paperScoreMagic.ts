import { ScorePaper } from 'types/StageResult';

const shifts: any = {
    "alphas": {
        "mask": 0x0000000F,
        "mask2": 0x0000000F00000000,
        "shift": 0,
        "shift2": 28 
    },
    "bravos": {
        "mask": 0x000000F0,
        "mask2": 0x000000F000000000,
        "shift": 4,
        "shift2": 32
    },
    "charlies": {
        "mask": 0x00000F00,
        "mask2": 0x00000F0000000000,
        "shift": 8,
        "shift2": 36
    },
    "deltas": {
        "mask": 0x0000F000,
        "mask2": 0x0000F00000000000,
        "shift": 12,
        "shift2": 40
    },
    "noShoots": {
        "mask": 0x000F0000,
        "mask2": 0x000F000000000000,
        "shift": 16,
        "shift2": 44
    },
    "misses": {
        "mask": 0x00F00000,
        "mask2": 0x00F0000000000000,
        "shift": 20,
        "shift2": 48
    },
    "noPenaltyMisses": {
        "mask": 0x0F000000,
        "mask2": 0x0F00000000000000,
        "shift": 24,
        "shift2": 52
    }
}

export function calcScore(stageResultsTS: any[]): ScorePaper {
    let values: any = {};
    for(let item of stageResultsTS){
        Object.keys(shifts).forEach((shiftKey) => {
            if(values[shiftKey] == undefined)
                values[shiftKey] = 0;
            
            const masksShifts = shifts[shiftKey];
            values[shiftKey] += ((item & masksShifts.mask) >> masksShifts.shift) + ((item & masksShifts.mask2) >> masksShifts.shift2);
        })
    }
    let score: ScorePaper = {
        alphas: values["alphas"],
        bravos: values["bravos"],
        charlies: values["charlies"],
        deltas: values["deltas"],
        misses: values["misses"],
        noPenaltieMisses: values["noPenaltyMisses"],
        noShoots: values["noShoots"]
    };
    return score;
}