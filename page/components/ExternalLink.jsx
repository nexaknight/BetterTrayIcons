// The attribute order is part of the i18n catalog key when a link sits
// inside translated copy, so it matches the msgids in po/page.pot
export function ExternalLink({href, children, ...rest}) {
    return <a href={href} target="_blank" rel="noopener" {...rest}>{children}</a>;
}
