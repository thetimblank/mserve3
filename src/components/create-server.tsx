import * as React from 'react';
import { Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

type CreateServerProps = React.ComponentProps<typeof Button>;

export const CreateServer: React.FC<CreateServerProps> = ({ children, ...props }) => {
	return (
		<Button variant='link' {...props} asChild>
			<Link to='/servers/new'>
				<Plus />
				{children ?? 'Create new server'}
			</Link>
		</Button>
	);
};

export default CreateServer;
