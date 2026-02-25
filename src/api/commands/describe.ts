import * as vscode from "vscode";
import { flagMapper, makeSimpleCommand } from "../CommandUtils";
import { FixedJob, ChangeInfo } from "../CommonTypes";
import { isTruthy } from "../../TsUtils";

export interface DescribeOptions {
    chnums: string[];
    omitDiffs?: boolean;
    shelved?: boolean;
}

const describeFlags = flagMapper<DescribeOptions>(
    [
        ["S", "shelved"],
        ["s", "omitDiffs"],
    ],
    "chnums",
    [],
    { lastArgIsFormattedArray: true },
);

const describeCommand = makeSimpleCommand("describe", describeFlags);

export type DepotFileOperation = {
    depotPath: string;
    revision: string;
    operation: string;
};

export type DescribedChangelist = ChangeInfo & {
    affectedFiles: DepotFileOperation[];
    shelvedFiles: DepotFileOperation[];
    fixedJobs: FixedJob[];
};

function populateFiles(files: DepotFileOperation[], changeData: any): void {
    let fileIndex = 0;
    while (changeData[`depotFile${fileIndex}`]) {
        files.push({
            depotPath: changeData[`depotFile${fileIndex}`],
            revision: changeData[`rev${fileIndex}`] || "",
            operation: changeData[`action${fileIndex}`] || "",
        });
        fileIndex++;
    }
}

function parseDescribeChangelist(
    changeData: any,
    options?: DescribeOptions,
): DescribedChangelist | undefined {
    if (!changeData || typeof changeData !== "object") {
        return undefined;
    }

    const chnum = changeData.change;
    const user = changeData.user;
    const client = changeData.client;
    const dateStr = changeData.time;
    const description = changeData.desc ? changeData.desc.split("\n") : [];
    const isPending = changeData.status === "pending";

    const affectedFiles: DepotFileOperation[] = [];
    const shelvedFiles: DepotFileOperation[] = [];
    if (!options?.shelved) {
        populateFiles(affectedFiles, changeData);
    } else {
        populateFiles(shelvedFiles, changeData);
    }
    const fixedJobs: FixedJob[] = [];
    let fileIndex = 0;
    while (changeData[`job${fileIndex}`]) {
        fixedJobs.push({
            id: changeData[`job${fileIndex}`],
            description: changeData[`jobstat${fileIndex}`] || "",
        });
        fileIndex++;
    }

    console.log("Parsing with options:", options);

    return {
        chnum,
        user,
        description,
        client,
        isPending,
        date: dateStr ? new Date(parseInt(dateStr) * 1000) : undefined,
        affectedFiles,
        shelvedFiles,
        fixedJobs,
    };
}

function parseDescribeOutput(
    output: string,
    options?: DescribeOptions,
): DescribedChangelist[] {
    const jsonData = JSON.parse(output);
    if (!Array.isArray(jsonData)) {
        return [];
    }
    return jsonData
        .map((changeData) => parseDescribeChangelist(changeData, options))
        .filter(isTruthy);
}

export async function describe(
    resource: vscode.Uri,
    options: DescribeOptions,
): Promise<DescribedChangelist[]> {
    const output = await describeCommand(resource, options);
    return parseDescribeOutput(output, options);
}

export interface GetShelvedOptions {
    chnums: string[];
}

export type ShelvedChangeInfo = { chnum: number; paths: string[] };

function parseShelvedDescribeOuput(output: string): ShelvedChangeInfo[] {
    const jsonData = JSON.parse(output);
    if (!Array.isArray(jsonData)) {
        return [];
    }

    return jsonData
        .map((changeData: any) => ({
            chnum: parseInt(changeData.change),
            paths: extractDepotFiles(changeData),
        }))
        .filter((item) => item.paths.length > 0);
}

function extractDepotFiles(changeData: any): string[] {
    const paths: string[] = [];
    let fileIndex = 0;
    while (changeData[`depotFile${fileIndex}`]) {
        paths.push(changeData[`depotFile${fileIndex}`]);
        fileIndex++;
    }
    return paths;
}

export async function getShelvedFiles(
    resource: vscode.Uri,
    options: GetShelvedOptions,
): Promise<ShelvedChangeInfo[]> {
    if (options.chnums.length === 0) {
        return [];
    }
    const output = await describeCommand(resource, {
        chnums: options.chnums,
        omitDiffs: true,
        shelved: true,
    });
    return parseShelvedDescribeOuput(output);
}

export interface GetFixedJobsOptions {
    chnum: string;
}

export async function getFixedJobs(resource: vscode.Uri, options: GetFixedJobsOptions) {
    const output = await describe(resource, {
        chnums: [options.chnum],
        omitDiffs: true,
    });

    // Handle the new format where fixedJobs are already structured in the response
    const describedChangelist = output[0];
    if (!describedChangelist?.fixedJobs) {
        return [];
    }

    // Convert the fixedJobs to match the FixedJob type
    return describedChangelist.fixedJobs.map((job) => ({
        id: job.id,
        description: Array.isArray(job.description) ? job.description : [job.description],
    }));
}
