import { flagMapper, makeSimpleCommand, asyncOuputHandler } from "../CommandUtils";
import { isTruthy } from "../../TsUtils";

export interface BranchesOptions {
    nameFilter?: string;
    max?: number;
}

const branchesFlags = flagMapper<BranchesOptions>([
    ["E", "nameFilter"],
    ["m", "max"],
]);

const branchesCommand = makeSimpleCommand("branches", branchesFlags);

export type BranchInfo = {
    branch: string;
    date: string;
    description: string;
};

function parseBranchLine(line: Record<string, string>) {
    // p4-node format:
    // {"branch":"newTestBranch","Update":"1772100662","Description":"Created by skumarSuper.\n"}
    if (!line.branch || !line.Update || !line.Description) {
        return undefined;
    }

    // Convert Unix timestamp to YYYY/MM/DD format
    const timestamp = parseInt(line.Update, 10) * 1000;
    const dateObj = new Date(timestamp);
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, "0");
    const day = String(dateObj.getDate()).padStart(2, "0");

    return {
        branch: line.branch,
        date: `${year}/${month}/${day}`,
        description: line.Description.replace(/\n$/, ""),
    };
}

function parseBranchesOutput(output: string): BranchInfo[] {
    const parsed = JSON.parse(output) as Record<string, string>[];
    return parsed.map(parseBranchLine).filter(isTruthy);
}

export const branches = asyncOuputHandler(branchesCommand, parseBranchesOutput);
