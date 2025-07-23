import * as vscode from "vscode";
import {
    flagMapper,
    makeSimpleCommand,
    splitIntoChunks,
    mergeAll,
    splitIntoSections,
} from "../CommandUtils";
import { FstatInfo, PerforceFile } from "../CommonTypes";
import { isTruthy } from "../../TsUtils";
import { splitIntoLines } from "../CommandUtils";

export interface FstatOptions {
    depotPaths: PerforceFile[];
    chnum?: string;
    limitToShelved?: boolean;
    outputPendingRecord?: boolean;
    limitToOpened?: boolean;
    limitToClient?: boolean;
}

function parseZTagField(field: string) {
    // examples:
    // ... depotFile //depot/testArea/stuff
    // ... mapped
    const matches = /[.]{3} (\w+)[ ]*(.+)?/.exec(field);
    if (matches) {
        return { [matches[1]]: matches[2] ? matches[2] : "true" } as Partial<FstatInfo>;
    }
}

function parseZTagBlock(block: string) {
    return splitIntoLines(block).map(parseZTagField).filter(isTruthy);
}

function parseFstatSection(file: string) {
    return mergeAll({ depotFile: "" }, ...parseZTagBlock(file)) as FstatInfo;
}

function parseFstatOutput(fstatOutput: string): FstatInfo[] {
    try {
        // Parse the string into a JSON array
        const jsonArray = JSON.parse(fstatOutput);

        // Convert each JSON object to FstatInfo
        return jsonArray.map((obj: any) => {
            // Ensure depotFile exists and merge with default values
            return mergeAll({ depotFile: "" }, obj) as FstatInfo;
        });
    } catch (error) {
        console.error("Failed to parse fstat output:", error);
        // Fallback to original parsing method for non-JSON input
        const all = splitIntoSections(fstatOutput.trim()).map((file) =>
            parseFstatSection(file)
        );
        return all;
    }
}

function parseFstatOutputToMap(fstatOutput: string): Map<string, string> {
    const map = new Map<string, string>();
    try {
        // Parse the string into a JSON array
        const jsonArray = JSON.parse(fstatOutput);

        // Iterate over each object in the array
        jsonArray.forEach((obj: any) => {
            Object.entries(obj).forEach(([key, value]) => {
                map.set(key, String(value)); // Add key-value pairs to the map
            });
        });
    } catch (error) {
        console.error("Failed to parse fstat output:", error);
    }

    return map;
}

const fstatFlags = flagMapper<FstatOptions>(
    [
        ["e", "chnum"],
        ["Or", "outputPendingRecord"],
        ["Rs", "limitToShelved"],
        ["Ro", "limitToOpened"],
        ["Rc", "limitToClient"],
    ],
    "depotPaths"
);

const fstatBasic = makeSimpleCommand("fstat", fstatFlags).ignoringStdErr;

export async function getFstatInfo(resource: vscode.Uri, options: FstatOptions) {
    const chunks = splitIntoChunks(options.depotPaths);
    const promises = chunks.map((paths) =>
        fstatBasic(resource, { ...options, ...{ depotPaths: paths } })
    );

    const fstats = await Promise.all(promises);
    return fstats.flatMap((output) => parseFstatOutput(output));
}

/**
 * perform an fstat and map the results back to the right files
 * ONLY WORKS IF THE PASSED IN PATHS ARE DEPOT PATH STRINGS without any revision specifiers
 * (TODO - this whole module could be reworked to something better...)
 */
export async function getFstatInfoMapped(resource: vscode.Uri, options: FstatOptions) {
    const all = await getFstatInfo(resource, options);
    return options.depotPaths.map((file) => all.find((fs) => fs["depotFile"] === file));
}
