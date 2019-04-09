import React, { Fragment } from "react";
import File from 'fileable-component-file';
import Folder from 'fileable-component-folder';
import Clear from 'fileable-component-clear';
export default async () => <>
    <File name='a.html'></File>
    <File name='b.js'></File>
    <Folder name='0'>
        <File name='c.html' ></File >
        <File name='d.js' ></File >
    </Folder >
    <Clear target='**/*.html' />
</>;
