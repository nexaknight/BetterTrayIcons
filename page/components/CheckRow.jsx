import {Icon, action} from './Icon.jsx';

export function CheckRow({children}) {
    return <li><Icon src={action('select')} />{children}</li>;
}
