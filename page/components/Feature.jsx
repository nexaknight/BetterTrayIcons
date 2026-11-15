import {Icon, action} from './Icon.jsx';

export function Feature({icon, title, text, className, children}) {
    return (
        <article className={className ? `feature ${className}` : 'feature'}>
            <div className="feature-icon"><Icon src={action(icon)} /></div>
            <h3 data-i18n="">{title}</h3>
            <p data-i18n="">{text}</p>
            {children}
        </article>
    );
}
