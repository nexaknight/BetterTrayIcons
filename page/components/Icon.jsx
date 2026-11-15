const ACTION_ICONS = 'assets/icons/hicolor/scalable/actions';
const MEDIA_ICONS = 'media/page';

export const action = name => `${ACTION_ICONS}/bti-${name}-symbolic.svg`;
export const media = file => `${MEDIA_ICONS}/${file}`;

// A symbolic SVG tinted through a CSS mask, see svg.bti in SiteHead.jsx
export function Icon({src, className, ...rest}) {
    return (
        <svg
            aria-hidden="true"
            className={className ? `bti ${className}` : 'bti'}
            style={{'--bti': `url(${src})`}}
            {...rest}
        />
    );
}
