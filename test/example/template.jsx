import React, { Fragment } from "react";
import { File, Clear, Folder } from "../../dist/lib/index.js";
const title = "TITLE";
const description = "DESCRIPTION";
import Head from "./head.jsx";

const template = async (fldr='fldr') => {
    return <Fragment>
    <Clear>
        <Folder name={fldr}>
            <File name="readme.md">
                {`\{# ${title}\}`}
                {`# ${description}`}
                <File>
                    #{title} #{description}
                </File>
                ```javascript
                <File src="./script.js" />
                ```
                <File cmd="date" />
            </File>
        </Folder>
        <File name="index.js">
            alert('hello');
        <File name="index.map.js"
                sidecar={({ contents: sidecar, currentName: name }) => ({
                    sidecar,
                    name,
                    content: "sourcemap"
                })}
            >
            // link to sourcemap
            </File>
        </File>
        <File name="index.html">
            &lt;!doctype html&gt;
            <html>
                <Head />
                <body> Hello World
                    <script src='index.js'></script>
                </body>
            </html>
        </File>
        <File name="index.css" src="./style.css" />
    </Clear>
</Fragment>};

export default template;
