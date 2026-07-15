import type { ErrorRequestHandler } from "express";
import { createLogger } from "../../common/logger.ts";
import { HttpError } from "../errors/http-error.ts";

const log = createLogger("http");

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
	const statusCode = error instanceof HttpError ? error.statusCode : 500;
	const message =
		error instanceof HttpError
			? error.message
			: error instanceof SyntaxError && "body" in error
				? "Invalid JSON request body"
				: "Internal server error";

	if (statusCode >= 500) {
		log.error("request failed", {
			method: req.method,
			path: req.path,
			error: error instanceof Error ? error.message : String(error),
		});
	}

	res.status(statusCode).json({ error: message });
};
