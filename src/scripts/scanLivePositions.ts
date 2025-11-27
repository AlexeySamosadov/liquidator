import { ethers } from 'ethers';
import { GMXContracts } from '../contracts/GMXContracts';
import { GMXAddresses } from '../types';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

// GMX V2 EventEmitter on Arbitrum
const EVENT_EMITTER_ADDRESS = '0xC8ee91A54287DB53897056e12D9819156D3822Fb';

const eventEmitterAbi = [
    'event EventLog1(address indexed msgSender, bytes32 indexed eventNameHash, bytes32 indexed topic1, tuple(tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) addressValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) uintValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) intValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) boolValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) bytes32Values, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) bytesValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) stringValues) eventData)',
    'event EventLog2(address indexed msgSender, bytes32 indexed eventNameHash, bytes32 indexed topic1, bytes32 indexed topic2, tuple(tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) addressValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) uintValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) intValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) boolValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) bytes32Values, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) bytesValues, tuple(address[] addressItems, uint256[] uintItems, int256[] intItems, bool[] boolItems, bytes32[] bytes32Items, bytes[] bytesItems, string[] stringItems) stringValues) eventData)'
];

const GMX_ARBITRUM_ADDRESSES: GMXAddresses = {
    reader: '0x65A6CC451BAfF7e7B4FDAb4157763aB4b6b44D0E',
    dataStore: '0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8',
    exchangeRouter: '0x7C68C7866A64FA2160F78EEaE1209B9F3A8d79ab',
    marketFactory: '0x0000000000000000000000000000000000000000',
    depositVault: '0x0000000000000000000000000000000000000000'
};

async function scanLivePositions() {
    // Use LlamaRPC as fallback/alternative
    const rpcUrl = 'https://arbitrum.llamarpc.com';
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const gmxContracts = new GMXContracts(provider, GMX_ARBITRUM_ADDRESSES);
    const eventEmitter = new ethers.Contract(EVENT_EMITTER_ADDRESS, eventEmitterAbi, provider);
    const ds = gmxContracts.getDataStore();

    console.log('📡 Starting Live Scan for GMX V2 Positions...');

    // 1. Scan recent blocks for PositionIncrease events
    const currentBlock = await provider.getBlockNumber();
    const scanRange = 50000; // Scan last 50k blocks (~2 hours)
    const fromBlock = currentBlock - scanRange;

    console.log(`Scanning blocks ${fromBlock} to ${currentBlock} (${scanRange} blocks)...`);

    // PositionIncrease event hash
    const positionIncreaseHash = ethers.keccak256(ethers.toUtf8Bytes('PositionIncrease'));

    // Try both EventLog1 and EventLog2
    // EventLog1(address indexed msgSender, bytes32 indexed eventNameHash, bytes32 indexed topic1, ...)
    // We want to filter by eventNameHash (2nd arg)
    const filter1 = eventEmitter.filters.EventLog1(null, positionIncreaseHash);
    const filter2 = eventEmitter.filters.EventLog2(null, positionIncreaseHash);

    const [events1, events2] = await Promise.all([
        eventEmitter.queryFilter(filter1, fromBlock, currentBlock),
        eventEmitter.queryFilter(filter2, fromBlock, currentBlock)
    ]);

    const events = [...events1, ...events2];

    console.log(`Found ${events.length} 'PositionIncrease' events.`);

    const potentialAccounts = new Set<string>();

    // 2. Extract Accounts
    for (const e of events) {
        const event = e as any;
        if (event.args) {
            // For EventLog1: topic1 is usually account
            // For EventLog2: topic1 is usually account
            // Let's try to extract from topic1 first
            try {
                const account = ethers.dataSlice(event.args.topic1, 12);
                potentialAccounts.add(ethers.getAddress(account));
            } catch (e) { }
        }
    }

    console.log(`Unique active accounts found: ${potentialAccounts.size}`);
    console.log('Verifying open positions...');
    console.log('='.repeat(80));

    const livePositions = [];

    // 3. Verify Positions
    console.log('\n');

    // Re-scanning events to extract full position details
    const candidates = new Map<string, any>();

    for (const e of events) {
        const event = e as any;
        if (event.args) {
            const data = event.args.data;
            // Decode data
            // GMX V2 EventUtils.emitPositionIncrease:
            // abi.encode(eventId, account, market, collateralToken, sizeInUsd, ...)

            try {
                const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                    [
                        'bytes32', 'address', 'address', 'address',
                        'uint256', 'uint256', 'uint256', 'uint256', // sizeInUsd, sizeInTokens, collateralAmount, borrowingFactor
                        'uint256', 'uint256', 'uint256', // funding...
                        'uint256', 'uint256', 'uint256', // executionPrice, indexTokenPrice, collateralTokenPrice
                        'uint256', 'uint256', 'uint256', // deltas...
                        'uint256', 'uint256', 'uint256', 'uint256',
                        'bool' // isLong
                    ],
                    data
                );

                const account = decoded[1];
                const market = decoded[2];
                const collateralToken = decoded[3];
                const isLong = decoded[22]; // Check index carefully. 
                // Let's verify the bool index. 
                // There are 21 uint256s before the bool? 
                // Let's count:
                // 1. bytes32 eventId
                // 2. address account
                // 3. address market
                // 4. address collateralToken
                // 5. uint256 sizeInUsd
                // 6. uint256 sizeInTokens
                // 7. uint256 collateralAmount
                // 8. uint256 borrowingFactor
                // 9. uint256 fundingFeeAmountPerSize
                // 10. uint256 longTokenClaimable...
                // 11. uint256 shortTokenClaimable...
                // 12. uint256 executionPrice
                // 13. uint256 indexTokenPrice
                // 14. uint256 collateralTokenPrice
                // 15. uint256 sizeInUsdDelta
                // 16. uint256 sizeInTokensDelta
                // 17. uint256 collateralAmountDelta
                // 18. uint256 borrowingFactorDelta
                // 19. uint256 fundingFeeAmountPerSizeDelta
                // 20. uint256 longTokenClaimable...Delta
                // 21. uint256 shortTokenClaimable...Delta
                // 22. bool isLong

                // So index 22 seems correct.

                const key = `${account}-${market}-${collateralToken}-${isLong}`;
                candidates.set(key, {
                    account,
                    market,
                    collateralToken,
                    isLong,
                    sizeInUsd: decoded[4]
                });

            } catch (e) {
                // console.warn('Failed to decode event', e);
            }
        }
    }

    console.log(`Identified ${candidates.size} unique position candidates from events.`);
    console.log('Verifying against DataStore...');

    for (const candidate of candidates.values()) {
        const positionKey = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ['address', 'address', 'address', 'bool'],
                [candidate.account, candidate.market, candidate.collateralToken, candidate.isLong]
            )
        );

        const sizeInUsdKey = ethers.keccak256(ethers.concat([ethers.toUtf8Bytes('POSITION_SIZE_IN_USD'), ethers.getBytes(positionKey)]));
        const collateralAmountKey = ethers.keccak256(ethers.concat([ethers.toUtf8Bytes('POSITION_COLLATERAL_AMOUNT'), ethers.getBytes(positionKey)]));

        try {
            const sizeInUsd = await ds.getUint(sizeInUsdKey);

            if (sizeInUsd > 0n) {
                const collateralAmount = await ds.getUint(collateralAmountKey);
                const sizeUsd = Number(ethers.formatUnits(sizeInUsd, 30));
                const collateralUsd = Number(ethers.formatUnits(collateralAmount, 6)); // Assume USDC
                const leverage = sizeUsd / (collateralUsd || 1);

                console.log(`✅ FOUND LIVE: ${candidate.account.slice(0, 8)} | Size: $${sizeUsd.toFixed(0)} | Lev: ${leverage.toFixed(1)}x`);

                livePositions.push({
                    account: candidate.account,
                    market: candidate.market,
                    collateralToken: candidate.collateralToken,
                    isLong: candidate.isLong,
                    sizeUsd,
                    collateralUsd,
                    leverage,
                    sizeInUsd: sizeInUsd.toString(),
                    collateralAmount: collateralAmount.toString()
                });
            }
        } catch (e) { }
    }

    console.log('='.repeat(80));
    console.log(`Scan Complete. Found ${livePositions.length} LIVE positions.`);

    if (livePositions.length > 0) {
        const outPath = path.join(__dirname, '../../data/gmx_live_positions.json');
        fs.writeFileSync(outPath, JSON.stringify(livePositions, null, 2));
        console.log(`Saved to ${outPath}`);
    }
}

scanLivePositions().catch(console.error);
