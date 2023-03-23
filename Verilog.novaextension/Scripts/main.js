
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
        if (nova.config.get("com.tomsalvo.verilog.enable-linting") == false) {
            return [];            
        }
        
        let enableDebugLog = nova.config.get("com.tomsalvo.verilog.enable-debug-log");

        // -- provideIssues() seems to sometimes be called before a document is ready to read. Bail out early if so.
        const docLen = editor.document.length;
        if (docLen === 0) {
            return [];
        }

        return new Promise(function(resolve, reject) {
            let documentPathComponents = editor.document.path.split("/");

            let tmpFilename = nova.fs.tempdir + '/' + documentPathComponents.slice(-1);

            const fullRange = new Range(0, docLen);
            try {
                let file = nova.fs.open(tmpFilename, "w");
                file.write(editor.document.getTextInRange(fullRange));
                file.close();
            }
            catch (e) {
                console.error(e);
                reject(e);
            }
 
            let processOptions =  {
                args: ['verilator', '--lint-only', '-Wall']
            };
            
            // -- Add the file's folder to the include path.
            const fileParentFolder = documentPathComponents.slice(0, -1).join("/");                        
            processOptions.args.push('-I' + fileParentFolder.replace(' ', '\ '));
            
            let runFromFileFolder = nova.workspace.config.get("com.tomsalvo.verilog.run-from-file-folder");
            if (runFromFileFolder == false) {
                // -- Set cwd to the project folder.
                processOptions.cwd = nova.workspace.path;
            }
            else {
                // -- Set cwd to parent directory of the file.
                processOptions.cwd = fileParentFolder;                
            }

            let additionalIncludeFiles = nova.workspace.config.get("com.tomsalvo.verilog.additional-include-paths");
            if (additionalIncludeFiles != null) {
                additionalIncludeFiles.forEach(async (path) => {
                    processOptions.args.push('-I' + path.replace(' ', '\ '));
                });
            }

            // -- Add the filename to the process options.
            processOptions.args.push(tmpFilename);
            
            if (enableDebugLog == true) {
                console.log("Parsing: '" + editor.document.path + "'");
                console.log("Command line:");
                console.log(processOptions.args);
            }

            let issues = [];

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

                let components = line.split(":");
                if (components.length < 4) {
                    return;
                }

                let severity = 0;
                if (components[0].startsWith('%Error')) {
                    severity = IssueSeverity.Error;
                }
                else if (line.startsWith('%Warning')) {
                    severity = IssueSeverity.Warning;
                }
                else {
                    return;
                }

                let issue = new Issue();
                issue.severity = severity;
                issue.line = components[2];
                issue.column = components[3];
                issue.message = components.slice(4).join(":");  
                
                // -- Verilator doesn't specify a separate end line
                issue.endLine = issue.line;
                
                // -- Nova seems to want endColumn to be the first "good" column rather than the last bad one.
                issue.endColumn = Number(issue.column) + 1;
                
                issues.push(issue);
            });

            process.onStdout(function(line) {
                if (enableDebugLog == true) {
                    console.log("   " + line);
                }
            });

            process.onDidExit(function(exitStatus) {
                nova.fs.remove(tmpFilename);
 
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
