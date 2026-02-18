import { m } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useSetup } from './SetupContext';
import { CircleCheck } from 'lucide-react';

export default function Slide4() {
	const { data } = useSetup();

	return (
		<m.div
			initial={{ scale: 0.75, y: 10, opacity: 0 }}
			whileInView={{ scale: 1, y: 0, opacity: 1 }}
			transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
			className='flex flex-col items-center text-center'>
			<CircleCheck className='size-20 text-green-500 mb-6' />
			<p className='text-3xl font-bold flex gap-5 items-center mb-2 w-fit'>You&apos;re Ready</p>
			<p className='mb-10'>You and other players can now connect to your server!</p>
			<div className='flex flex-col items-start text-start'>
				<p className='mb-4 flex gap-2 items-center'></p>
				<Accordion type='single' collapsible className='w-md'>
					<AccordionItem value='1'>
						<AccordionTrigger>Players can&apos;t connect?</AccordionTrigger>
						<AccordionContent className='flex flex-col items-start'>
							{[
								'Check if you correctly setup port forwarding on your PC',
								'Check if you correctly setup port forwarding on your Network',
								'Check if your server is online',
								'Check if you can connect with "localhost" or "127.0.0.1" on your own PC',
								"Check if you correctly setup your custom domain if you're using one",
								`Check if others can successfully "ping" your IP ${data.ip_hidden ? '' : `(Tell them to type "ping ${data.ip}" in command prompt/terminal)`}`,
							].map((item, i) => (
								<p key={i}>- {item}</p>
							))}
						</AccordionContent>
					</AccordionItem>
				</Accordion>
			</div>
		</m.div>
	);
}
