import {Person} from 'types/Person';
export type StageResult = {
    person: Person,
    time: number,
    points: number,
    stagePoints: number,
    stagePercent: number,
    hitFactor: number,
    divisionPlace?: number,
    overallPlace?: number,
    divisionRate?: number,
    overallRate?: number,
    penalties: number,
    dq?: boolean
};