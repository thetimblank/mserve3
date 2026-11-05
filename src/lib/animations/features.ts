// domMax (not domAnimation): SegmentedControl's sliding pill needs layout
// animations (`layoutId`). Loaded lazily, so it stays out of the main chunk.
import { domMax } from 'motion/react';
export default domMax;
