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
    ["-q"]
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
    withUser?: boolean
): (Annotation | undefined)[] {
    const parsed = JSON.parse(output);
    return parsed.map((item: any) => {
        if (!item) {
            return undefined;
        }

        return {
            line: item.data || "",
            revisionOrChnum: item.lower || item.revision || item.change || "",
            user: withUser ? item.user : undefined,
            date: withUser ? item.date : undefined,
        } as Annotation;
    });
}

export async function annotate(resource: vscode.Uri, options: AnnotateOptions) {
    const output = await annotateCommand(resource, options);
    return parseAnnotateOutput(output, options.outputUser);
}
