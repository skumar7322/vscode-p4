import { pipe } from "@arrows/composition";
import { flagMapper, makeSimpleCommand, asyncOuputHandler } from "../CommandUtils";
import { RawField } from "../CommonTypes";
import { getBasicField, parseSpecOutput } from "../SpecParser";
import { isTruthy } from "../../TsUtils";

export type Job = {
    job?: string;
    status?: string;
    user?: string;
    description?: string;
    rawFields: RawField[];
};

function mapToJobFields(rawFields: RawField[]): Job {
    return {
        job: getBasicField(rawFields, "Job")?.[0].trim(),
        status: getBasicField(rawFields, "Status")?.[0].trim(),
        user: getBasicField(rawFields, "User")?.[0].trim(),
        description: getBasicField(rawFields, "Description")?.join("\n"),
        rawFields,
    };
}

const parseJobSpec = pipe(parseSpecOutput, mapToJobFields);

export type JobOptions = {
    existingJob?: string;
};

const jobFlags = flagMapper<JobOptions>([], "existingJob", ["-o"], {
    lastArgIsFormattedArray: true,
});

export const outputJob = makeSimpleCommand("job", jobFlags);

export const getJob = asyncOuputHandler(outputJob, parseJobSpec);

export type JobFix = {
    job: string;
    chnum: string;
    date: string;
    user: string;
    client: string;
    status: string;
};

function parseJobFix(output: string): JobFix[] {
    try {
        const jsonData = JSON.parse(output);
        if (!Array.isArray(jsonData)) {
            return [];
        }

        return jsonData
            .map((jobData: any) => {
                if (!jobData || typeof jobData !== "object") {
                    return undefined;
                }

                const dateStr = jobData.Date;
                return {
                    job: jobData.Job || "",
                    chnum: jobData.Change || "",
                    date: dateStr ? new Date(parseInt(dateStr) * 1000).toString() : "",
                    user: jobData.User || "",
                    client: jobData.Client || "",
                    status: jobData.Status || "",
                };
            })
            .filter(isTruthy);
    } catch (error) {
        return [];
    }
}

export type FixesOptions = {
    job?: string;
};

const fixesFlags = flagMapper<FixesOptions>([["j", "job"]]);
const fixesCommand = makeSimpleCommand("fixes", fixesFlags);

export const fixes = asyncOuputHandler(fixesCommand, parseJobFix);

export type InputRawJobSpecOptions = {
    input: string;
};

export type CreatedJob = {
    rawOutput: string;
    job?: string;
};

function parseCreatedJob(createdStr: string): CreatedJob {
    // info should return [ 'Job job000008 saved.' ] but error because of swarm, but job got created
    const matches = /Job (\S*) (saved|not changed)/.exec(createdStr);

    return {
        rawOutput: createdStr,
        job: matches?.[1],
    };
}

const inputRawJobCommand = makeSimpleCommand(
    "job",
    () => ["-i"],
    (options: InputRawJobSpecOptions) => {
        return {
            input: options.input,
        };
    }
);

export const inputRawJobSpec = asyncOuputHandler(inputRawJobCommand, parseCreatedJob);
