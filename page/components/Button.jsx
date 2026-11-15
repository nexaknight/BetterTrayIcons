import {ExternalLink} from './ExternalLink.jsx';
import {Icon, action, media} from './Icon.jsx';
import {EGO_URL} from './urls.js';

// Same shape as buttonMarkup in public/components/button.js. Without a variant
// the element skips the shared .button look, for the panel and tray controls
// that carry their own styles. type goes ahead of class because hand-written
// <button> markup puts it there. title is the visible text, so the HTML title
// attribute comes in as tooltip.
export function Button({
    variant, className, type, as: Tag = 'a', label, leading,
    title, titleI18n, subtitle, textClass, trailing, tooltip, ...rest
}) {
    const classes = [variant && 'button', variant, className].filter(Boolean).join(' ');
    // An unset key would still claim its slot and move a call site's own
    // aria-label in front of the attributes written before it
    const labelAttribute = label ? {'aria-label': label} : {};
    return (
        <Tag type={type} className={classes || undefined} {...labelAttribute} {...rest} title={tooltip}>
            {leading}
            <ButtonText title={title} titleI18n={titleI18n} subtitle={subtitle} textClass={textClass} />
            {trailing}
        </Tag>
    );
}

// A titleI18n string wraps the title in its own translated span, for buttons
// whose icons sit next to the text
function ButtonText({title, titleI18n, subtitle, textClass}) {
    if (textClass) {
        return (
            <span className={textClass}>
                <strong>{title}</strong>
                {subtitle && <small>{subtitle}</small>}
            </span>
        );
    }
    if (titleI18n === undefined)
        return title;
    return <span data-i18n={titleI18n}>{title}</span>;
}

export function InstallButton({title}) {
    return (
        <Button
            as={ExternalLink}
            variant="primary"
            href={EGO_URL}
            leading={<Icon className="gnome-icon" src={media('gnome.svg')} />}
            title={title}
            titleI18n=""
            trailing={<Icon src={action('next')} />}
        />
    );
}
