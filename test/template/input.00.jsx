import React, { Fragment } from "react";
import File from 'fileable-component-file';
import Folder from 'fileable-component-folder';
export default async (name, content) => <File name={name} extension='.md'># {content}</File>;
