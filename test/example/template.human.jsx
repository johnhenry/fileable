import React, { Fragment } from "react";
import { File, Clear, Folder } from "../../dist/lib/index.js";
const title = "TITLE";
const description = "DESCRIPTION";
import Head from "./head.jsx";

const template = async (name) => {
    return <Fragment>
        <Clear>
            <Folder name={`${name}'s folder`}>
                <File name="time">
                    <File cmd="date" />
                </File>
            </Folder>
        </Clear>
    </Fragment>
};

export default template;
