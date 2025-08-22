import * as vscode from "vscode";
import { flagMapper, makeSimpleCommand } from "../CommandUtils";
import { PerforceFile, P4Commands } from "../CommonTypes";

export interface FilelogOptions {
    file: PerforceFile;
    followBranches?: boolean;
    omitNonContributoryIntegrations?: boolean;
}

const filelogFlags = flagMapper<FilelogOptions>(
    [
        ["i", "followBranches"],
        ["s", "omitNonContributoryIntegrations"],
    ],
    "file",
    ["-l", "-t"]
);

const filelog = makeSimpleCommand(P4Commands.FILELOG, filelogFlags);

export enum Direction {
    TO,
    FROM,
}

export type FileLogIntegration = {
    file: string;
    startRev?: string;
    endRev: string;
    operation: string;
    direction: Direction;
};

export type FileLogItem = {
    file: string;
    description: string;
    revision: string;
    chnum: string;
    operation: string;
    date?: Date;
    user: string;
    client: string;
    integrations: FileLogIntegration[];
};

export async function getFileHistory(resource: vscode.Uri, options: FilelogOptions) {
    const output = await filelog(resource, options);
    const parsed = parseFileLogOutputNew(output);
    return parsed;
}

function parseFileLogOutputNew(output: string): FileLogItem[] {
    // example:
    // ... #9 change 43 integrate on 2020/03/29 18:48:43 by zogge@default (text)
    //
    //    integrate from main
    //
    // ... ... copy into //depot/TestArea/newFile.txt#5
    // ... ... edit from //depot/TestArea/newFile.txt#3,#4
    const filelogDataArray = JSON.parse(output);
    if (!Array.isArray(filelogDataArray) || filelogDataArray.length < 0) {
        return []; //check if valid error coudld be thrown
    }

    const fileLogItems: FileLogItem[] = [];
    filelogDataArray.forEach((obj: any) => {
        // All revisions of a single file. Revisions will start from 0
        let revNumber = 0;
        let revision = obj["rev" + revNumber];
        while (revision !== undefined && revision !== null) {
            const file = obj["depotFile"];
            const chnum = obj["change" + revNumber];
            const operation = obj["action" + revNumber];
            const dateTimestamp = obj["time" + revNumber];
            const user = obj["user" + revNumber];
            const client = obj["client" + revNumber];
            const description = obj["desc" + revNumber];
            const integrations = getFileLogIntegration(obj, revNumber);

            fileLogItems.push({
                file,
                description,
                revision,
                chnum,
                operation,
                date: dateTimestamp
                    ? new Date(parseInt(dateTimestamp) * 1000)
                    : undefined,
                user,
                client,
                integrations,
            });

            revNumber++;
            revision = obj["rev" + revNumber];
        }
    });

    return fileLogItems;
}
function getFileLogIntegration(obj: any, revNumber: number): FileLogIntegration[] {
    // Get Integration details
    let revRevNum = 0;
    let file = obj["file" + revNumber + "," + revRevNum];
    const revIntegrations: FileLogIntegration[] = [];
    while (file !== undefined && file !== null) {
        const how = obj["how" + revNumber + "," + revRevNum];
        let operation = "";
        if (how !== null && how !== undefined) {
            operation = how.split(" ")[0];
        }
        const direction = how.includes("into") ? Direction.TO : Direction.FROM;

        const startRevStr = obj["srev" + revNumber + "," + revRevNum];
        const endRevStr = obj["erev" + revNumber + "," + revRevNum];

        // Parse startRevStr: can be "#none", "#1", or just "1"
        const startRev = parseRev(startRevStr);
        const endRev = parseRev(endRevStr);

        //ToDo: handle if any revision is #none
        const finalStartRev = endRev ? startRev : undefined;
        const finalEndRev = endRev ? endRev : startRev;
        revIntegrations.push({
            operation,
            direction,
            file,
            startRev: finalStartRev,
            endRev: finalEndRev,
        });
        revRevNum++;
        file = obj["file" + revNumber + "," + revRevNum];
    }
    return revIntegrations;
}

function parseRev(rev: string | undefined | null): string {
    if (!rev || rev === "#none") {
        return "none";
    } else if (rev.startsWith("#")) {
        return rev.substring(1);
    }
    return rev;
}
