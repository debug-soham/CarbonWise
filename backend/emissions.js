// Emission factors and footprint calculation for every log category.
// Values are kg CO2e per unit. They are representative averages for an
// individual in India, not precise lifecycle assessments.

const FACTORS = {
    energy: {
        // CEA CO2 Baseline Database (v19), Indian grid weighted average
        electricity: { label: 'Electricity', unit: 'kWh', factor: 0.716 },
        // IPCC 2006 default: 63.1 t CO2/TJ x 47.3 MJ/kg
        lpg: { label: 'Cooking gas (LPG)', unit: 'kg', factor: 2.98 },
        // Piped natural gas, per standard cubic metre (DESNZ 2024)
        png: { label: 'Piped natural gas (PNG)', unit: 'm³', factor: 2.02 },
        // Share of electricity emissions kept when it comes from renewables
        renewableMultiplier: 0.1
    },
    transport: {
        // Per passenger-km. Cars are per vehicle-km and split across passengers.
        // Mostly DESNZ 2024 conversion factors; EV uses ~0.15 kWh/km on the Indian grid.
        car_petrol: { label: 'Car (petrol)', factor: 0.164, perVehicle: true },
        car_diesel: { label: 'Car (diesel)', factor: 0.170, perVehicle: true },
        car_cng: { label: 'Car (CNG)', factor: 0.140, perVehicle: true },
        car_electric: { label: 'Car (electric)', factor: 0.107, perVehicle: true },
        motorbike: { label: 'Motorbike / scooter', factor: 0.114 },
        auto_rickshaw: { label: 'Auto-rickshaw', factor: 0.070 },
        bus: { label: 'Bus', factor: 0.102 },
        train: { label: 'Train / metro', factor: 0.035 },
        flight: { label: 'Domestic flight', factor: 0.246 },
        walk_cycle: { label: 'Walking / cycling', factor: 0 }
    },
    food: {
        // Per meal, approximated from Poore & Nemecek (2018) food impacts
        beef_lamb: { label: 'Beef or lamb meal', factor: 7.0 },
        chicken_pork: { label: 'Chicken or pork meal', factor: 1.8 },
        fish: { label: 'Fish or seafood meal', factor: 1.6 },
        vegetarian: { label: 'Vegetarian meal', factor: 0.9 },
        vegan: { label: 'Vegan meal', factor: 0.5 }
    },
    shopping: {
        // Per item, cradle-to-gate manufacturer and industry estimates
        tshirt: { label: 'T-shirt', factor: 7 },
        jeans: { label: 'Jeans', factor: 33 },
        shoes: { label: 'Pair of shoes', factor: 14 },
        jacket: { label: 'Jacket', factor: 25 },
        book: { label: 'Book', factor: 1.2 },
        smartphone: { label: 'Smartphone', factor: 70 },
        laptop: { label: 'Laptop', factor: 250 },
        television: { label: 'Television', factor: 350 }
    }
};

const CATEGORIES = Object.keys(FACTORS);

class ValidationError extends Error {}

// Parse an optional numeric input; blank means 0
function readNumber(value, label, { max = 1e6, integer = false } = {}) {
    if (value === undefined || value === null || value === '') return 0;
    const n = Number(value);
    if (!Number.isFinite(n)) throw new ValidationError(`${label} must be a number.`);
    if (n < 0) throw new ValidationError(`${label} cannot be negative.`);
    if (n > max) throw new ValidationError(`${label} must be at most ${max}.`);
    if (integer && !Number.isInteger(n)) throw new ValidationError(`${label} must be a whole number.`);
    return n;
}

function pick(table, key, label) {
    const entry = typeof key === 'string' && Object.hasOwn(table, key) && table[key];
    if (!entry || typeof entry !== 'object' || entry.factor === undefined) {
        throw new ValidationError(`Please choose a valid ${label}.`);
    }
    return entry;
}

const round = (n) => Math.round(n * 1000) / 1000;

// Returns { co2_impact, details, description } or throws ValidationError
function calculate(category, input) {
    switch (category) {
        case 'energy': {
            const f = FACTORS.energy;
            const electricity = readNumber(input.electricity, 'Electricity usage', { max: 100000 });
            const lpg = readNumber(input.lpg, 'LPG usage', { max: 10000 });
            const png = readNumber(input.png, 'Natural gas usage', { max: 100000 });
            const renewable = input.renewable === true || input.renewable === 'true';

            if (electricity === 0 && lpg === 0 && png === 0) {
                throw new ValidationError('Enter electricity or gas usage to log.');
            }

            const elecImpact = electricity * f.electricity.factor * (renewable ? f.renewableMultiplier : 1);
            const co2 = elecImpact + lpg * f.lpg.factor + png * f.png.factor;
            const parts = [
                electricity && `${electricity} kWh electricity${renewable ? ' (renewable)' : ''}`,
                lpg && `${lpg} kg LPG`,
                png && `${png} m³ PNG`
            ].filter(Boolean);

            return {
                co2_impact: round(co2),
                details: { electricity, lpg, png, renewable },
                description: parts.join(', ')
            };
        }
        case 'transport': {
            const mode = pick(FACTORS.transport, input.mode, 'transport mode');
            const distance = readNumber(input.distance, 'Distance', { max: 50000 });
            if (distance === 0) throw new ValidationError('Enter the distance travelled.');
            const passengers = mode.perVehicle
                ? Math.max(1, readNumber(input.passengers, 'Passengers', { max: 10, integer: true }))
                : 1;

            return {
                co2_impact: round(distance * mode.factor / passengers),
                details: { mode: input.mode, distance, passengers },
                description: `${mode.label}, ${distance} km${passengers > 1 ? ` shared by ${passengers}` : ''}`
            };
        }
        case 'food': {
            const meal = pick(FACTORS.food, input.meal, 'meal type');
            const count = readNumber(input.count, 'Number of meals', { max: 100, integer: true });
            if (count === 0) throw new ValidationError('Enter how many meals.');

            return {
                co2_impact: round(count * meal.factor),
                details: { meal: input.meal, count },
                description: `${count} × ${meal.label.toLowerCase()}`
            };
        }
        case 'shopping': {
            const item = pick(FACTORS.shopping, input.item, 'item');
            const quantity = readNumber(input.quantity, 'Quantity', { max: 100, integer: true });
            if (quantity === 0) throw new ValidationError('Enter a quantity.');

            return {
                co2_impact: round(quantity * item.factor),
                details: { item: input.item, quantity },
                description: `${quantity} × ${item.label.toLowerCase()}`
            };
        }
        default:
            throw new ValidationError('Unknown category.');
    }
}

module.exports = { FACTORS, CATEGORIES, calculate, ValidationError };
