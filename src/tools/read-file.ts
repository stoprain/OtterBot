import * as fs from "fs";
import * as path from "path";
import { createTool } from "../tool-registry";

const MAX_BYTES = 100_000;

export const readFileTool = createTool({
  name: "read_file",

  description:
    "Read the contents of a file at the given path. " +
    "Returns the file content as a string. " +
    "Use this to examine source code, configuration files, or any text file.",

  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to read. Can be absolute or relative to the current working directory.",
      },
    },
    required: ["path"],
  },

  async execute(params) {
    const filePath = params["path"];
    if (typeof filePath !== "string" || !filePath) {
      throw new Error("read_file: 'path' parameter must be a non-empty string");
    }

    const absPath = path.resolve(filePath);

    if (!fs.existsSync(absPath)) {
      return `File not found: ${absPath}`;
    }

    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      return `'${absPath}' is a directory, not a file. Use list_files to inspect directories.`;
    }

    if (stat.size > MAX_BYTES) {
      const fd = fs.openSync(absPath, "r");
      const buf = Buffer.alloc(MAX_BYTES);
      fs.readSync(fd, buf, 0, MAX_BYTES, 0);
      fs.closeSync(fd);
      const truncated = buf.toString("utf8");
      return (
        truncated +
        `\n\n[File truncated — showing first ${MAX_BYTES} of ${stat.size} bytes]`
      );
    }

    return fs.readFileSync(absPath, "utf8");
  },
});
