import {connectScoped, ruleDispatcher} from '../../shared/lifecycle.js';
import {BOX_SIDES} from '../../shared/boxStyle.js';

export function spacingLinkKey(keyPrefix) {
    return `${keyPrefix}-linked`;
}

const SPACING_KEY_BASES = Object.freeze(['icon', 'toggle', 'overflow-container']);

const SPACING_LINK_GROUPS = SPACING_KEY_BASES.flatMap(base =>
    ['padding', 'margin'].map(kind => {
        const prefix = `${base}-${kind}`;
        return {linkKey: spacingLinkKey(prefix), prefix};
    }));

export function wireSpacingSync(window, settings) {
    const rules = [];
    for (const group of SPACING_LINK_GROUPS) {
        for (const side of BOX_SIDES) {
            const key = `${group.prefix}-${side}`;
            rules.push({
                match: k => k === key,
                run: () => {
                    if (settings.get_boolean(group.linkKey))
                        _spreadValue(settings, group, key);
                },
            });
        }
    }
    connectScoped(window, settings, 'changed', ruleDispatcher(rules), 'close-request');
}

// The propagated writes re-enter the dispatcher, equal values end the chain.
function _spreadValue(settings, group, sourceKey) {
    const value = settings.get_int(sourceKey);
    for (const side of BOX_SIDES) {
        const key = `${group.prefix}-${side}`;
        if (key !== sourceKey && settings.get_int(key) !== value)
            settings.set_int(key, value);
    }
}
