import React, { Fragment } from "react";
import File from 'fileable-component-file';
import { ok } from "assert";

const Composed = ({ position = 0, ...props }) => <File {...props} name="composed" >{props.children}</File>

const N = ({ name, length, ...props }) => {
    const files = [];
    for (let i = 0; i < parseInt(length); i++){
        files.push(
            <File {...props} name={`${name}${i}`} key={i}>
                {i}{':\n'}{ props.children }
        </File >);
    }
    return <>{files}</>;
}


export default async () => <>
    <File></File>
    <File name="empty" />
    <File extension=".md" />
    <File name="empty" extension=".md" />
    <File name="hello">Hello</File>
    <File name="world" content="World" />
    <File name="google.html" src='https://www.google.com' />
    <File name="package.json" src='../../package.json' />
    <File name="datefile" cmd='date' />
    <File name='foodfile' cmd='|grep Cheese'>{
`- Feta Cheese
- Broccoli
- American Cheese
- Cheesebread`
    }</File>
    <File name="permission" mode={0o655} />
    <File name="index.html">
        <html>
            <svg width="400" height="110">
                <rect width="300" height="100" style={{ fill: "rgb(0,0,255);stroke-width:3;stroke:rgb(0,0,0)" }} />
            </svg>
        </html>
    </File>
    <File name="index-doctype.html" sgmldoctype="html" >
        <html>

        </html>
    </File>
    <File name="double" transform={(buff) => Buffer.concat([buff, buff])} >Hello</File>
    <File name="doubleps" transform={(buff) => Buffer.concat([buff, buff])} >Hello<File ps>Goodbye</File></File>
    <File name='doubleclone'>World<File clone /></File>;
    <Composed >Hello</Composed>
    <File name='append' >0</File>;
    <File name='append' append >1</File>;
    <File name='end' end >1</File>;
    <N length='3' name='multi-' >Hi</N>
    {/* <File name='a.txt' end>
        hello{'\n'}
        <File clone ps='there' name='b.txt'/>
    </File>; */}
</>;
