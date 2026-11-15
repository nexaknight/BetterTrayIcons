import {Button} from '../components/Button.jsx';
import {ExternalLink} from '../components/ExternalLink.jsx';
import {Icon, action} from '../components/Icon.jsx';
import {REPO_URL} from '../components/urls.js';

const CONTRIBUTING_URL = `${REPO_URL}/blob/main/CONTRIBUTING.md`;

export function Community() {
    return (
        <section className="community wrap">
            <div className="community-row">
                <div className="community-mark"><Icon src={action('github')} /></div>
                <div>
                    <p className="community-copy" data-i18n="">
                        Found a bug or have an idea? Open an issue or send a pull request on GitHub.
                    </p>
                </div>
                <Button
                    as={ExternalLink}
                    variant="secondary"
                    href={CONTRIBUTING_URL}
                    leading={<Icon src={action('github')} />}
                    title="How to Contribute"
                    titleI18n=""
                    trailing={<> <span>↗</span></>}
                />
            </div>
        </section>
    );
}
