import { PerforceFile } from "../CommonTypes";
import { P4Commands } from "../CommonTypes";
import { flagMapper, makeSimpleCommand } from "../CommandUtils";
import * as vscode from "vscode";

export interface AnnotateOptions {
    outputChangelist?: boolean;
    outputUser?: boolean;
    followBranches?: boolean;
    file: PerforceFile;
}

const annotateFlags = flagMapper<AnnotateOptions>(
    [
        ["c", "outputChangelist"],
        ["u", "outputUser"],
        ["i", "followBranches"],
    ],
    "file",
    ["-q"],
);

const annotateCommand = makeSimpleCommand(P4Commands.ANNOTATE, annotateFlags);

export type Annotation = {
    line: string;
    revisionOrChnum: string;
    user?: string;
    date?: string;
};

function parseAnnotateOutput(
    output: string,
    withUser?: boolean,
): (Annotation | undefined)[] {
    const parsed = JSON.parse(output) as Record<string, string>[];
    return parsed
        .filter((item) => {
            // Skip null items and file metadata (items with depotFile but no data)
            if (!item) {
                return false;
            }
            if (item.depotFile && !item.data) {
                return false;
            }
            return true;
        })
        .map((item) => {
            if (!item) {
                return undefined;
            }

            // Remove trailing newline from data if present
            const lineData = item.data?.replace(/\n$/, "") || "";

            return {
                line: lineData,
                // lower contains the changelist number that introduced this line
                revisionOrChnum: item.lower || item.revision || item.change || "",
                user: withUser ? item.user : undefined,
                date: withUser ? item.date : undefined,
            };
        });
}

export async function annotate(resource: vscode.Uri, options: AnnotateOptions) {
    const output = await annotateCommand(resource, options);
    return parseAnnotateOutput(output, options.outputUser);
}
