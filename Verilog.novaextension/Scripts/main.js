
exports.activate = function() {
    // -- Do work when the extension is activated
    console.info("Verilog extension for Nova activated.");
}

exports.deactivate = function() {
    // -- Clean up state before the extension is deactivated
}

class IssuesProvider {
    constructor() {

    }

    provideIssues(editor) {
        let enableDebugLog = nova.config.get("com.tomsalvo.verilog.enable-debug-log");

        // -- provideIssues() seems to sometimes be called before a document is ready to read. Bail out early if so.
        const docLen = editor.document.length;
        if (docLen === 0) {
            return [];
        }

        return new Promise(function(resolve, reject) {
            let issues = [];

            let processOptions =  {
                args: ['verilator', '--lint-only', '-Wall']
            };

            if (editor.document.isRemote || typeof editor.document.path != "string") {
                // -- We only deal with files that are local and has been saved.
                return;
            }

            const fileParentFolder = editor.document.path.split("/").slice(0, -1).join("/");

            let runFromFileFolder = nova.workspace.config.get("com.tomsalvo.verilog.run-from-file-folder");
            if (runFromFileFolder == false) {
                // -- Set cwd to the project folder.
                processOptions.cwd = nova.workspace.path;

                // -- Add the file's folder to the include path.
                processOptions.args.push('-I' + fileParentFolder.replace(' ', '\ '));
            }
            else {
                // -- Set cwd to parent directory of the file.
                processOptions.cwd = fileParentFolder;                

                // -- Add the file's folder to the include path.
                processOptions.args.push('-I.');
            }

            let additionalIncludeFiles = nova.workspace.config.get("com.tomsalvo.verilog.additional-include-paths");
            if (additionalIncludeFiles != null) {
                additionalIncludeFiles.forEach(async (path) => {
                    processOptions.args.push('-I' + path.replace(' ', '\ '));
                });
            }

            // -- Add the filename to the process options.
            processOptions.args.push(editor.document.path);

            if (enableDebugLog == true) {
                console.log("Parsing: '" + editor.document.path + "'");
                console.log("Command line:");
                console.log(processOptions.args);
            }

            // -- Initialize process.
            const process = new Process("/usr/bin/env", processOptions);

            // -- Collect and process error/warning lines.
            process.onStderr(function(line) {
                if (enableDebugLog == true) {
                    console.log("   " + line);
                }

                // -- Line may include spaces at front and back for formatting.
                line = line.trim();

                // -- Some lines are blank for human-friendly formatting reasons; bail out now if so
                if (line === "") {
                    return;
                }

                if (!line.startsWith('%Error: ')) {
                    return;
                }

                let components = line.substring(8).split(":");
                if (components.length < 4) {
                    return;
                }

                let issue = new Issue();
                issue.code = components[0];
                issue.message = components[3].substring(1);
                issue.severity = IssueSeverity.Error;
                issue.line = components[1];
                issue.column = components[2];

                // -- Verilator doesn't specify a separate end line
                issue.endLine = components[1];

                // -- Nova seems to want endColumn to be the first "good" column rather than the last bad one.
                issue.endColumn = Number(components[2]) + 1;

                issues.push(issue);
            });

            process.onStdout(function(line) {
                if (enableDebugLog == true) {
                    console.log("   " + line);
                }
            });

            process.onDidExit(function(exitStatus) {
                if (exitStatus == 127) {
                    // -- Status 127 most likely means `verilator` is not installed or can't be found in $PATH.
                    let issue = new Issue();
                    issue.message = "Verilator not found; see Verilog Nova extension documentation";
                    issue.severity = IssueSeverity.Warning;
                    issue.line = 1;
                    issues.push(issue);
                    resolve(issues);
                }
                else if (exitStatus <= 0 || exitStatus > 1) {
                    // -- Note: Verilator has exit status 1 if it reported errors.
                    reject();
                }
                else {
                    resolve(issues);
                }
            });

            try {
                process.start();
            }
            catch (e) {
                console.error(e);
                reject(e);
            }
        });
    }
}

nova.assistants.registerIssueAssistant("verilog", new IssuesProvider());
