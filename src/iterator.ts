import { FILEABLE_COMPONENT} from 'fileable-components';

/**
 * Iterator
 * @kind function
 * @name iterator
 * @param {object} options
 * @param {string} options.folder_context - Folder into which files should be renddered
 * @param {string} options.template_context - Location of template. Used to determine relateive
 * @example
 * ```javascript
 * import {iterator} from 'fileable';
 * ```
 */
const iterator = async function* (element, {
        folder_context = '',
        template_context =''
        } = {
            folder_context: '',
            template_context:''
    }) {
    element = await element;
    if (element.type && element.type[FILEABLE_COMPONENT]) {
        yield* element.type({
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
    } else {
        if (typeof element.type === 'function') {
            yield* iterator(element.type({
                ...element.props
            }), {folder_context, template_context});
        }else if (typeof element === 'function') {
            yield* iterator(element({
                ...element.props
            }), { folder_context, template_context });
        }
    }
};
export default iterator;
