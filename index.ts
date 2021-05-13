import config from 'config';
import ffmpeg from 'fluent-ffmpeg';
import winston from 'winston';

const logger = winston.createLogger(config.get("logger"))

logger.info("Started");