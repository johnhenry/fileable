import FSCOMPONENTSYMBOL from './FSCOMPONENTSYMBOL.ts';

/**
 * Iterator
 * @kind function
 * @name iterator
 * @param {object} input
 * @example
 * ```javascript
 * import {iterator} from 'fileable';
 * ```
 */
const iterator = async function* (element, {
        folder_context = [],
        template_context =''
        } = {
            folder_context: [],
            template_context:''
    }) {
    if (element.type && element.type[FSCOMPONENTSYMBOL]) {
        yield* new element.type({
            folder_context,
            template_context,
            ...element.props
        });
    } else if (element.type === Symbol.for('react.fragment')) {
        const children = Array.isArray(element.props.children)
            ? element.props.children
            : element.props.children
            ? [element.props.children]
            : [];
        for (const child of children) {
            yield* iterator(child, {
                folder_context,
                template_context
            });
        }
    }
};
export default iterator;
