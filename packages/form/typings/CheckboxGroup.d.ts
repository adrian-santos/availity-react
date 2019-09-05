import * as React from 'react';
import { FormGroupProps } from './FormGroup';


interface CheckboxGroupProps extends FormGroupProps {
    name: string;
    label?: string;
    onChange?: (value: any) => void;
}

declare class CheckboxGroup extends React.Component<CheckboxGroupProps> {}

export default CheckboxGroup;