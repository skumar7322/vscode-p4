// p4node.d.ts in your project root or types folder
declare module "p4node" {
    interface P4Props {
        user?: string;
        port?: string;
        client?: string;
        progv?: string;
        config?: string;
        cwd?: string;
    }

    interface P4Instance {
        Connect(): boolean;
        Run(cmd: string[]): any[];
        RunAsync(cmd: string[], callback: (result: any, error: any) => void): void;
        SetOpts(opts: P4Props): void;
        GetOpts(): P4Props;
    }

    export function New(props: P4Props): P4Instance;
    export function setLogger(
        callback: (severity: string, message: string) => void
    ): void;
}
