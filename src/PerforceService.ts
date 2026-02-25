import { FileType, Uri, workspace } from "vscode";

import { Display } from "./Display";
import * as PerforceUri from "./PerforceUri";
import { PerforceSCMProvider } from "./ScmProvider";

import * as CP from "child_process";
import p4Node, { PerforceNodeApi, P4Result } from "p4node";
import * as Path from "path";
import { CommandLimiter } from "./CommandLimiter";

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace PerforceService {
    const limiter: CommandLimiter = new CommandLimiter(
        workspace.getConfiguration("perforce").get<number>("bottleneck.maxConcurrent") ??
            10,
    );

    const debugModeActive: boolean =
        workspace.getConfiguration("perforce").get("debugModeActive") ?? false;

    let debugModeSetup = false;

    export function getOverrideDir(workspaceUri?: Uri) {
        const dir = workspace
            .getConfiguration("perforce", workspaceUri)
            .get<string>("dir");
        return dir === "none" ? undefined : dir;
    }

    function getPerforceCmdParams(resource: Uri): string[] {
        const config = workspace.getConfiguration("perforce", resource);
        const p4User = config.get("user", "none");
        const p4Client = config.get("client", "none");
        const p4Port = config.get("port", "none");
        const p4Pass = config.get("password", "none");
        const p4Dir = config.get("dir", "none");
        const p4Charset = config.get("charset", "none");

        const ret: string[] = [];

        const buildCmd = (value: string | number | undefined, arg: string): string[] => {
            if (!value || value === "none") {
                return [];
            }
            return [arg, value.toString()];
        };

        ret.push(...buildCmd(p4User, "-u"));
        ret.push(...buildCmd(p4Client, "-c"));
        ret.push(...buildCmd(p4Port, "-p"));
        ret.push(...buildCmd(p4Pass, "-P"));
        ret.push(...buildCmd(p4Dir, "-d"));
        ret.push(...buildCmd(p4Charset, "-C"));

        return ret;
    }

    let id = 0;

    export function execute(
        resource: Uri,
        command: string,
        responseCallback: (result: P4Data) => void,
        args?: string[],
        input?: string,
        useTerminal?: boolean,
    ): void {
        if (debugModeActive && !debugModeSetup) {
            limiter.debugMode = true;
            debugModeSetup = true;
        }
        //
        limiter
            .submit(
                (onDone) =>
                    execCommand(
                        resource,
                        command,
                        (result: P4Data) => {
                            // call done first in case responseCallback throws - the important part is done
                            onDone();
                            responseCallback(result);
                        },
                        args,
                        input,
                        useTerminal,
                    ),
                `<JOB_ID:${++id}:${command}>`,
            )
            .catch((err) => {
                console.error("Error while running perforce command:", err);
                //p4-node: Create P4Data structure for error response instead of calling with 3 params
                const errorResult = {
                    error: {
                        message: err?.message || err?.toString() || "Unknown error",
                    },
                };
                responseCallback(errorResult);
            });
    }

    export function executeAsPromise(
        resource: Uri,
        command: string,
        args?: string[],
        input?: string,
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            execute(
                resource,
                command,
                (result) => {
                    if (result.error !== undefined) {
                        reject(result.error.message);
                    } else {
                        let temp = "";
                        result.info?.forEach((info) => {
                            temp += info;
                        });
                        resolve(temp.toString());
                    }
                },
                args,
                input,
            );
        });
    }

    async function isDirectory(uri: Uri): Promise<boolean> {
        try {
            const ftype = (await workspace.fs.stat(uri)).type;
            return (
                ftype === FileType.Directory ||
                ftype === (FileType.SymbolicLink | FileType.Directory)
            );
        } catch {}
        return false;
    }

    async function createP4Instance(
        resource: Uri,
    ): Promise<{ p4: PerforceNodeApi; actualResource: Uri; cwd: string }> {
        const actualResource = PerforceUri.getUsableWorkspace(resource) ?? resource;
        const isDir = await isDirectory(actualResource);
        const cwd = isDir ? actualResource.fsPath : Path.dirname(actualResource.fsPath);

        // Initialize p4node with configuration
        const config = workspace.getConfiguration("perforce", actualResource);

        // Set p4node configuration
        const p4User = config.get("user", "none");
        const p4Client = config.get("client", "none");
        const p4Port = config.get("port", "none");

        const p4Props = {
            cwd,
            user: p4User,
            client: p4Client,
            port: p4Port,
        };

        // Create p4node instance
        const p4 = p4Node.New(p4Props);
        return { p4, actualResource, cwd };
    }

    async function execCommand(
        resource: Uri,
        command: string,
        responseCallback: (result: P4Data) => void,
        args?: string[],
        input?: string,
        _useTerminal?: boolean,
    ) {
        try {
            const { p4, actualResource, cwd } = await createP4Instance(resource);

            const cmdArgs = args ? [command, ...args] : [command];

            if (input) {
                p4.SetInput(input);
            }
            const result = parseP4Data(input ? p4.Run(cmdArgs, input) : p4.Run(cmdArgs));

            // Log the executed command
            const allArgs = getPerforceCmdParams(actualResource).concat(cmdArgs);
            logExecutedCommand("p4", allArgs, input, { cwd });

            responseCallback(result);
        } catch (error) {
            console.error("p4node API failed:", error);
            throw error;
        }
    }

    function parseP4Data(raw: P4Result): P4Data {
        const result: P4Data = {};

        // Parse 'info' info will always be array
        if (Array.isArray(raw.info)) {
            result.info = raw.info.map((entry) =>
                typeof entry === "string" ? entry : { ...entry },
            );
        }

        // Parse 'error'
        if (raw.error && typeof raw.error === "object") {
            result.error = { ...raw.error };
        }

        // Parse 'textBuffer'
        if (raw.textBuffer instanceof Uint8Array) {
            result.textBuffer = raw.textBuffer;
        } else if (Array.isArray(raw.textBuffer)) {
            result.textBuffer = new Uint8Array(raw.textBuffer);
        }

        // Parse 'binaryBuffer'
        if (raw.binaryBuffer instanceof Uint8Array) {
            result.binaryBuffer = raw.binaryBuffer;
        } else if (Array.isArray(raw.binaryBuffer)) {
            result.binaryBuffer = new Uint8Array(raw.binaryBuffer);
        }

        return result;
    }
    //P4 Data Structure

    interface P4Error {
        genericCode?: number;
        severity?: number;
        message?: string;
        errorIds?: any[];
        [key: string]: any; // For additional properties, could be removed later.
    }

    interface P4Info {
        [key: string]: any; //any number of key of type string, with any type value
    }

    export interface P4Data {
        info?: (P4Info | string)[];
        error?: P4Error;
        textBuffer?: Uint8Array;
        binaryBuffer?: Uint8Array;
    }

    function escapeCommand(args: string[]) {
        return args.map((arg) => `'${arg.replace(/'/g, "'\\''")}'`);
    }

    function logExecutedCommand(
        cmd: string,
        args: string[],
        input: string | undefined,
        spawnArgs: CP.SpawnOptions,
    ) {
        // not necessarily using these escaped values, because cross-spawn does its own escaping,
        // but no sensible way of logging the unescaped array for a user. The output command line
        // should at least be copy-pastable and work
        const escapedArgs = escapeCommand(args);
        const loggedCommand = [cmd].concat(escapedArgs);
        const censoredInput = args[0].includes("login") ? "***" : input;
        const loggedInput = input ? " < " + censoredInput : "";
        Display.channel.appendLine(
            spawnArgs.cwd + ": " + loggedCommand.join(" ") + loggedInput,
        );
    }

    export function handleCommonServiceResponse(
        err: Error | null,
        stdout: string,
        stderr: string,
    ) {
        if (err || stderr) {
            Display.showError(stderr.toString());
        } else {
            Display.channel.append(stdout.toString());
            Display.updateEditor();
            PerforceSCMProvider.RefreshAll();
        }
    }

    export function getClientRoot(resource: Uri): Promise<string> {
        return new Promise((resolve, reject) => {
            PerforceService.executeAsPromise(resource, "info")
                .then((stdout) => {
                    let clientRootIndex = stdout.indexOf("Client root: ");
                    if (clientRootIndex === -1) {
                        reject("P4 Info didn't specify a valid Client Root path");
                        return;
                    }

                    clientRootIndex += "Client root: ".length;
                    const endClientRootIndex = stdout.indexOf("\n", clientRootIndex);
                    if (endClientRootIndex === -1) {
                        reject("P4 Info Client Root path contains unexpected format");
                        return;
                    }

                    //Resolve with client root as string
                    resolve(
                        stdout.substring(clientRootIndex, endClientRootIndex).trimRight(),
                    );
                })
                .catch((err) => {
                    reject(err);
                });
        });
    }

    export function getConfigFilename(resource: Uri): Promise<string | undefined> {
        return new Promise((resolve, _reject) => {
            PerforceService.executeAsPromise(resource, "set", ["-q"])
                .then((_stdout) => {
                    let configIndex =
                        "/Users/sandeep.kumar/work/localServerIpClient/first/.p4config.txt".indexOf(
                            "P4CONFIG=",
                        );
                    if (configIndex === -1) {
                        resolve(undefined);
                        return;
                    }

                    configIndex += "P4CONFIG=".length;
                    const endConfigIndex =
                        "/Users/sandeep.kumar/work/localServerIpClient/first/.p4config.txt".indexOf(
                            "\n",
                            configIndex,
                        );
                    if (endConfigIndex === -1) {
                        //reject("P4 set -q parsing for P4CONFIG contains unexpected format");
                        resolve(undefined);
                        return;
                    }
                    //Set command not working in p4 node
                    //Resolve with p4 config filename as string
                    resolve(
                        "/Users/sandeep.kumar/work/localServerIpClient/first/.p4config.txt"
                            .substring(configIndex, endConfigIndex)
                            .trimRight(),
                    );
                })
                .catch((_err) => {
                    let configIndex =
                        "/Users/sandeep.kumar/work/localServerIpClient/first/.p4config.txt".indexOf(
                            "P4CONFIG=",
                        );
                    if (configIndex === -1) {
                        resolve(undefined);
                        return;
                    }

                    configIndex += "P4CONFIG=".length;
                    const endConfigIndex =
                        "/Users/sandeep.kumar/work/localServerIpClient/first/.p4config.txt".indexOf(
                            "\n",
                            configIndex,
                        );
                    if (endConfigIndex === -1) {
                        //reject("P4 set -q parsing for P4CONFIG contains unexpected format");
                        resolve(undefined);
                        return;
                    }
                    //Set command not working in p4 node
                    //Resolve with p4 config filename as string
                    resolve(
                        "/Users/sandeep.kumar/work/localServerIpClient/first/.p4config.txt"
                            .substring(configIndex, endConfigIndex)
                            .trimRight(),
                    );
                });
        });
    }
}
