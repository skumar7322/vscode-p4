import { PerforceFile } from "../CommonTypes";
import { P4Commands } from "../CommonTypes";
import { flagMapper, makeSimpleCommand, splitIntoLines } from "../CommandUtils";
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
    // const lines = splitIntoLines(output);
    //examples with / without user:
    // 1: super 2020/01/29 hello this is a file
    // 1: hello this is a file

    const parsed = JSON.parse(output);

    // Directly map JSON objects to Annotation objects
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

    /* const regex = withUser ? /^(\d+): (\S+) (\S+) (.*?)$/ : /^(\d+): (.*?)$/;
    const linePos = withUser ? 4 : 2;

    return lines.map((line) => {
        const matches = regex.exec(line);

        if (matches) {
            const revisionOrChnum = matches[1];
            const user = withUser ? matches[2] : undefined;
            const date = withUser ? matches[3] : undefined;
            return {
                line: matches[linePos],
                revisionOrChnum,
                user,
                date,
            };
        } else {
            return undefined;
        }
    }); */
}

export async function annotate(resource: vscode.Uri, options: AnnotateOptions) {
    const output = await annotateCommand(resource, options);
    return parseAnnotateOutput(output, options.outputUser);
}
