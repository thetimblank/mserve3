import JsonArrayConfigFileEditor from './server-config-file-editor/json-array-editor';
import PlainTextConfigFileEditor from './server-config-file-editor/plain-text-editor';
import ServerPropertiesFileEditor from './server-config-file-editor/server-properties-editor';
import type { ServerConfigFileEditorProps } from './server-config-file-editor/types';
import VelocityTomlEditor from './server-config-file-editor/velocity-toml-editor';

export type { ServerConfigFileEditorProps };

export default function ServerConfigFileEditor(props: ServerConfigFileEditorProps) {
	if (props.definition.format === 'json') {
		return <JsonArrayConfigFileEditor {...props} />;
	}

	if (props.definition.kind === 'server-properties') {
		return <ServerPropertiesFileEditor {...props} />;
	}

	if (props.definition.kind === 'velocity-toml') {
		return <VelocityTomlEditor {...props} />;
	}

	return <PlainTextConfigFileEditor {...props} />;
}
