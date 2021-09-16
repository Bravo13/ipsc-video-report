import {Person} from 'types/Person';
import { NonRelativeModuleNameResolutionCache } from 'typescript';

type NumOrNull = number | null;

export type ScorePenalties = {
    noShoots: NumOrNull,
    misses: NumOrNull,
    noPenaltieMisses: NumOrNull
}

export type ScorePaper = {
    alphas: NumOrNull,
    bravos: NumOrNull,
    charlies: NumOrNull,
    deltas: NumOrNull
} & ScorePenalties

export type ScoreSteel = {
    hits: NumOrNull
} & ScorePenalties

export type Score = {
    paper?: ScorePaper,
    steel?: ScoreSteel,
    penalties: ScorePenalties | undefined,
    procedures?: NumOrNull,
    additionalPenalties?: NumOrNull
}

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
    dq?: boolean,
    score?: Score
};