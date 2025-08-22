import {
    workspace,
    Uri,
    FileType,
    Task,
    tasks,
    ShellExecution,
    Disposable,
    ShellQuoting,
    ShellQuotedString,
} from "vscode";

import * as PerforceUri from "./PerforceUri";
import { Display } from "./Display";
import { PerforceSCMProvider } from "./ScmProvider";

import * as CP from "child_process";
import spawn from "cross-spawn";
import { CommandLimiter } from "./CommandLimiter";
import * as Path from "path";
import { configAccessor } from "./ConfigService";
import p4Node from "p4node";

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace PerforceService {
    const limiter: CommandLimiter = new CommandLimiter(
        workspace.getConfiguration("perforce").get<number>("bottleneck.maxConcurrent") ??
            10
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

    function expandCmdPath(path: string, resource: Uri): string {
        if (path.includes("${workspaceFolder}")) {
            const ws =
                workspace.getWorkspaceFolder(resource) ?? workspace.workspaceFolders?.[0];
            const sub = ws?.uri.fsPath ?? "";
            return path.replace("${workspaceFolder}", sub);
        }
        return path;
    }

    function getPerforceCmdPath(resource: Uri): string {
        let p4Path = workspace.getConfiguration("perforce").get("command", "none");

        if (p4Path === "none" || p4Path === "") {
            const isWindows = process.platform.startsWith("win");
            p4Path = isWindows ? "p4.exe" : "p4";
        } else {
            const toUNC = (path: string): string => {
                let uncPath = path;

                if (!uncPath.startsWith("\\\\")) {
                    const replaceable = uncPath.split("\\");
                    uncPath = replaceable.join("\\\\");
                }

                return uncPath;
            };

            p4Path = toUNC(expandCmdPath(p4Path, resource));
        }
        return p4Path;
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
        useTerminal?: boolean
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
                        useTerminal
                    ),
                `<JOB_ID:${++id}:${command}>`
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
        input?: string
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            execute(
                resource,
                command, //p4-node: ToDO
                (result) => {
                    // if (err) {
                    //     reject(err.message);
                    // } else if (stderr) {
                    //     reject(stderr);
                    // } else {
                    //     resolve(stdout.toString());
                    // }
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
                input
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

    async function execCommandP4Node(
        resource: Uri,
        command: string,
        responseCallback: (result: P4Data) => void,
        args?: string[],
        input?: string,
        useTerminal?: boolean
    ) {
        try {
            const actualResource = PerforceUri.getUsableWorkspace(resource) ?? resource;
            const isDir = await isDirectory(actualResource);
            const cwd = isDir
                ? actualResource.fsPath
                : Path.dirname(actualResource.fsPath);

            // Initialize p4node with configuration
            const config = workspace.getConfiguration("perforce", actualResource);

            // Set p4node configuration
            const p4User = config.get("user", "none");
            const p4Client = config.get("client", "none");
            const p4Port = config.get("port", "none");

            // TODO: add better way to handle this props.
            const p4Props = {
                cwd,
                user: p4User !== "none" ? p4User : "skumarSuper",
                client: p4Client !== "none" ? p4Client : "skumar_frist_temp",
                port: p4Port !== "none" ? p4Port : "192.168.29.67:1666",
            };

            // Create p4node instance
            const p4 = p4Node.New(p4Props);

            // Connect to Perforce

            // Build command arguments
            const cmdArgs = args ? [command, ...args] : [command];

            // Execute command with p4node
            const result = parseP4Data(p4.Run(cmdArgs));

            // Log the executed command
            const allArgs = getPerforceCmdParams(actualResource).concat(cmdArgs);
            logExecutedCommand("p4", allArgs, input, { cwd });

            // Handle result - p4node returns array of objects
            // Dont parse here just return the result with understandable datastructure

            responseCallback(result);
            return;
        } catch (error) {
            // Log the error and fall back to spawning if p4node fails
            console.warn("p4node API failed, falling back to CLI:", error);
            // Fall through to CLI implementation below
        }
    }

    function parseP4Data(raw: any): P4Data {
        const result: P4Data = {};

        // Parse 'info'
        if (Array.isArray(raw.info)) {
            result.info = raw.info.map((entry: any) => {
                if (typeof entry === "object") {
                    return { ...entry };
                }
                return {};
            });
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

    async function execCommand(
        resource: Uri,
        command: string,
        responseCallback: (result: P4Data) => void,
        args?: string[],
        input?: string,
        useTerminal?: boolean
    ) {
        // Use p4node API instead of spawning processes for better performance
        if (true) {
            try {
                await execCommandP4Node(
                    resource,
                    command,
                    responseCallback,
                    args,
                    input,
                    useTerminal
                );
                return;
            } catch (error) {
                console.warn("p4node API failed, falling back to CLI:", error);
            }
        }

        // Fallback to original CLI spawning for terminal operations or if p4node fails
        const actualResource = PerforceUri.getUsableWorkspace(resource) ?? resource;
        const cmd = getPerforceCmdPath(actualResource);

        const allArgs: string[] = getPerforceCmdParams(actualResource);
        allArgs.push(command);

        if (args) {
            allArgs.push(...args);
        }

        const isDir = await isDirectory(actualResource);
        const cwd = isDir ? actualResource.fsPath : Path.dirname(actualResource.fsPath);

        const env = { ...process.env, PWD: cwd };
        const spawnArgs: CP.SpawnOptions = { cwd, env };
        // spawnPerforceCommand(
        //     cmd,
        //     allArgs,
        //     spawnArgs,
        //     responseCallback,
        //     input,
        //     useTerminal
        // );
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

    interface P4Data {
        info?: P4Info[];
        error?: P4Error;
        textBuffer?: Uint8Array;
        binaryBuffer?: Uint8Array;
    }

    function spawnPerforceCommand(
        cmd: string,
        allArgs: string[],
        spawnArgs: CP.SpawnOptions,
        responseCallback: (err: Error | null, stdout: string, stderr: string) => void,
        input?: string,
        useTerminal?: boolean
    ) {
        logExecutedCommand(cmd, allArgs, input, spawnArgs);
        if (useTerminal) {
            spawnInTerminal(cmd, allArgs, spawnArgs, responseCallback);
        } else {
            spawnNormally(cmd, allArgs, spawnArgs, responseCallback, input);
        }
    }

    let spawnedId = 0;

    function spawnNormally(
        cmd: string,
        allArgs: string[],
        spawnArgs: CP.SpawnOptions,
        responseCallback: (err: Error | null, stdout: string, stderr: string) => void,
        input?: string
    ) {
        const config = workspace.getConfiguration("perforce");
        const debug = config.get("debugP4Commands", false);
        const id = ++spawnedId;
        if (debug) {
            console.log("[P4 RUN]", id, cmd, allArgs, spawnArgs);
        }

        const child = spawn(cmd, allArgs, spawnArgs);

        let called = false;
        child.on("error", (err: Error) => {
            if (!called) {
                called = true;
                if (debug) {
                    console.log("[P4 ERR]", id, err);
                }
                responseCallback(err, "", "");
            }
        });

        if (input !== undefined) {
            if (!child.stdin) {
                throw new Error("Child does not have standard input");
            }
            child.stdin.end(input, "utf8");
        }

        getResults(child).then((value: string[]) => {
            if (!called) {
                if (debug) {
                    console.log(
                        "[P4 RES]",
                        id,
                        "Stdout:\n" + value[0],
                        "\n============================",
                        "\nStderr:\n" + value[1] + "\n"
                    );
                }
                responseCallback(null, value[0] ?? "", value[1] ?? "");
            }
        });
    }

    let taskId = 0;

    async function spawnInTerminal(
        cmd: string,
        allArgs: string[],
        spawnArgs: CP.SpawnOptions,
        responseCallback: (err: Error | null, stdout: string, stderr: string) => void
    ) {
        const editor = configAccessor.resolveP4EDITOR;
        const env = editor ? { P4EDITOR: editor } : undefined;
        const quotedArgs = allArgs.map<ShellQuotedString>((arg) => {
            return {
                value: arg,
                quoting: ShellQuoting.Strong,
            };
        });
        const exec = new ShellExecution(cmd, quotedArgs, {
            cwd: spawnArgs.cwd,
            env,
        });
        try {
            const myTask = new Task(
                { type: "perforce" },
                "Perforce #" + ++taskId,
                "perforce",
                exec
            );
            await tasks.executeTask(myTask);
            const disposable: Disposable = tasks.onDidEndTask((task) => {
                if (task.execution.task.name === myTask.name) {
                    responseCallback(null, "", "");
                    disposable.dispose();
                }
            });
        } catch (err) {
            responseCallback(err as Error, "", "");
        }
    }

    function escapeCommand(args: string[]) {
        return args.map((arg) => `'${arg.replace(/'/g, "'\\''")}'`);
    }

    function logExecutedCommand(
        cmd: string,
        args: string[],
        input: string | undefined,
        spawnArgs: CP.SpawnOptions
    ) {
        // not necessarily using these escaped values, because cross-spawn does its own escaping,
        // but no sensible way of logging the unescaped array for a user. The output command line
        // should at least be copy-pastable and work
        const escapedArgs = escapeCommand(args);
        const loggedCommand = [cmd].concat(escapedArgs);
        const censoredInput = args[0].includes("login") ? "***" : input;
        const loggedInput = input ? " < " + censoredInput : "";
        Display.channel.appendLine(
            spawnArgs.cwd + ": " + loggedCommand.join(" ") + loggedInput
        );
    }

    async function getResults(child: CP.ChildProcess): Promise<string[]> {
        return Promise.all([readStdOut(child), readStdErr(child)]);
    }

    async function readStdOut(child: CP.ChildProcess) {
        let output: string = "";
        if (child.stdout) {
            for await (const data of child.stdout) {
                output += data.toString();
            }
        }
        return output;
    }

    async function readStdErr(child: CP.ChildProcess) {
        let output: string = "";
        if (child.stderr) {
            for await (const data of child.stderr) {
                output += data.toString();
            }
        }
        return output;
    }

    export function handleCommonServiceResponse(
        err: Error | null,
        stdout: string,
        stderr: string
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
                        stdout.substring(clientRootIndex, endClientRootIndex).trimRight()
                    );
                })
                .catch((err) => {
                    reject(err);
                });
        });
    }

    export function getConfigFilename(resource: Uri): Promise<string | undefined> {
        return new Promise((resolve, reject) => {
            PerforceService.executeAsPromise(resource, "set", ["-q"])
                .then((stdout) => {
                    let configIndex = "/Users/sandeep.kumar/work/localServerIpClient/first/.p4config.txt".indexOf(
                        "P4CONFIG="
                    );
                    if (configIndex === -1) {
                        resolve(undefined);
                        return;
                    }

                    configIndex += "P4CONFIG=".length;
                    const endConfigIndex = "/Users/sandeep.kumar/work/localServerIpClient/first/.p4config.txt".indexOf(
                        "\n",
                        configIndex
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
                            .trimRight()
                    );
                })
                .catch((err) => {
                    let configIndex = "/Users/sandeep.kumar/work/localServerIpClient/first/.p4config.txt".indexOf(
                        "P4CONFIG="
                    );
                    if (configIndex === -1) {
                        resolve(undefined);
                        return;
                    }

                    configIndex += "P4CONFIG=".length;
                    const endConfigIndex = "/Users/sandeep.kumar/work/localServerIpClient/first/.p4config.txt".indexOf(
                        "\n",
                        configIndex
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
                            .trimRight()
                    );
                });
        });
    }
}
