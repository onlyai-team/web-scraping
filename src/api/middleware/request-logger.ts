import type { RequestHandler } from "express";
import { createLogger, formatMs } from "../../common/logger.ts";

const log = createLogger("http");

export const requestLogger: RequestHandler = (req, res, next) => {
	const start = performance.now();
	res.on("finish", () => {
		log.info("request", {
			method: req.method,
			path: req.path,
			status: res.statusCode,
			duration: formatMs(performance.now() - start),
		});
	});
	next();
};
