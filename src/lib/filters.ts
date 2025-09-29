// ECG Signal Processing Filters for 360Hz Sampling Rate
// Optimized Butterworth IIR digital filters for medical-grade ECG processing
// Reference: https://docs.scipy.org/doc/scipy/reference/generated/scipy.signal.butter.html

// High-Pass Butterworth IIR digital filter
// Sampling rate: 360.0 Hz, frequency: 0.5 Hz
// Filter is order 2, implemented as second-order sections (biquads)
// Purpose: Remove baseline drift and DC offset
export class HighpassFilter {
    private z1_0: number = 0.0;
    private z2_0: number = 0.0;

    process(inputSample: number): number {
        let output: number = inputSample;

        // Biquad section 0
        const x0: number = output - (-1.98765881 * this.z1_0) - (0.98773450 * this.z2_0);
        output = 0.99384833 * x0 + -1.98769666 * this.z1_0 + 0.99384833 * this.z2_0;
        this.z2_0 = this.z1_0;
        this.z1_0 = x0;

        return output;
    }

    reset(): void {
        this.z1_0 = 0.0;
        this.z2_0 = 0.0;
    }
}

// Low-Pass Butterworth IIR digital filter
// Sampling rate: 360.0 Hz, frequency: 30.0 Hz
// Filter is order 2, implemented as second-order sections (biquads)
// Purpose: Remove high-frequency noise while preserving ECG morphology
export class LowpassFilter {
    private z1_0: number = 0.0;
    private z2_0: number = 0.0;

    process(inputSample: number): number {
        let output: number = inputSample;

        // Biquad section 0
        const x0: number = output - (-1.27963242 * this.z1_0) - (0.47759225 * this.z2_0);
        output = 0.04948996 * x0 + 0.09897991 * this.z1_0 + 0.04948996 * this.z2_0;
        this.z2_0 = this.z1_0;
        this.z1_0 = x0;

        return output;
    }

    reset(): void {
        this.z1_0 = 0.0;
        this.z2_0 = 0.0;
    }
}

// Band-Stop Butterworth IIR digital filter (Notch Filter)
// Sampling rate: 360.0 Hz, frequency: [48.0, 52.0] Hz
// Filter is order 2, implemented as second-order sections (biquads)
// Purpose: Remove 50Hz power line interference (48-52Hz band)
export class NotchFilter {
    private z1_0: number = 0.0;
    private z2_0: number = 0.0;
    private z1_1: number = 0.0;
    private z2_1: number = 0.0;

    process(inputSample: number): number {
        let output: number = inputSample;

        // Biquad section 0
        const x0: number = output - (-1.21708497 * this.z1_0) - (0.95085885 * this.z2_0);
        output = 0.95183262 * x0 + -1.22439830 * this.z1_0 + 0.95183262 * this.z2_0;
        this.z2_0 = this.z1_0;
        this.z1_0 = x0;

        // Biquad section 1
        const x1: number = output - (-1.29217906 * this.z1_1) - (0.95280880 * this.z2_1);
        output = 1.00000000 * x1 + -1.28635883 * this.z1_1 + 1.00000000 * this.z2_1;
        this.z2_1 = this.z1_1;
        this.z1_1 = x1;

        return output;
    }

    reset(): void {
        this.z1_0 = 0.0;
        this.z2_0 = 0.0;
        this.z1_1 = 0.0;
        this.z2_1 = 0.0;
    }
}

// Export individual filter classes for specific use cases
export { HighpassFilter as Highpass };
export { LowpassFilter as Lowpass };
export { NotchFilter as Notch };

// Filter specifications for reference
export const FILTER_SPECS = {
    SAMPLING_RATE: 360, // Hz
    HIGHPASS: {
        cutoff: 0.5, // Hz
        order: 2,
        purpose: "Remove baseline drift and DC offset"
    },
    LOWPASS: {
        cutoff: 30, // Hz
        order: 2,
        purpose: "Remove high-frequency noise"
    },
    NOTCH: {
        centerFreq: 50, // Hz
        bandwidth: [48, 52], // Hz
        order: 2,
        purpose: "Remove power line interference"
    }
};