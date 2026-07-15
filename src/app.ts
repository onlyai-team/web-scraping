import express from "express";
import { errorHandler } from "./api/middleware/error-handler.ts";
import { notFoundHandler } from "./api/middleware/not-found.ts";
import { requestLogger } from "./api/middleware/request-logger.ts";
import { createRouter } from "./api/routes/index.ts";
import type { AppDependencies } from "./api/types.ts";

export function createApp(dependencies: AppDependencies) {
	const app = express();

	app.disable("x-powered-by");
	app.use(cors);
	app.use(express.json({ limit: "1mb" }));
	app.use(express.urlencoded({ extended: false, limit: "1mb" }));
	app.use(requestLogger);
	app.use(createRouter(dependencies));
	app.use(notFoundHandler);
	app.use(errorHandler);

	return app;
}

function cors(
	_req: express.Request,
	res: express.Response,
	next: express.NextFunction,
) {
	res.set({
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
	});

	if (_req.method === "OPTIONS") {
		res.sendStatus(204);
		return;
	}

	next();
}
