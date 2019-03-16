import {
    Component
} from 'react';
import FSCOMPONENTSYMBOL from './FSCOMPONENTSYMBOL.js';
import path from 'path';
import render from './iterator.js';

const Clear = class extends Component {
    constructor(props) {
        super(props);
        this[Symbol.asyncIterator] = async function* () {
            const props = this.props;
            let {
                folder_context = [],
                template_context = '',
                    target,
            } = props;
            const targets = (target && target.split(':')) || ['.'];
            for (const target of targets) {
                yield {
                    clear: target,
                    folder_context
                }
            }
            const children = Array.isArray(props.children) ?
                props.children :
                props.children ? [props.children] : [];
            for (const child of children) {
                yield* render(child, {
                    folder_context,
                    template_context
                })
            }
        }
    }
    render() {
        return null;
    }
};
Clear[FSCOMPONENTSYMBOL] = true;
export default Clear;
