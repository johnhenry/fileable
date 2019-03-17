import FSCOMPONENTSYMBOL from './FSCOMPONENTSYMBOL.ts';
const render = async function* (element, {
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
            yield* render(child, {
                folder_context,
                template_context
            });
        }
    }
};
export default render;
