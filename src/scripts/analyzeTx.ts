import { ethers } from 'ethers';

async function analyzeTx() {
    const provider = new ethers.JsonRpcProvider('https://arb1.arbitrum.io/rpc');
    const txHash = '0xf2025b8f1ae403d13f91f947998190125161c2089230bf9652dcfc8f1e951ec5';

    console.log('🔍 Analyzing transaction:', txHash);
    console.log('='.repeat(80));

    try {
        // Get transaction
        const tx = await provider.getTransaction(txHash);
        if (!tx) {
            console.log('❌ Transaction not found');
            return;
        }

        console.log('\n📋 Transaction Details:');
        console.log('From:', tx.from);
        console.log('To:', tx.to);
        console.log('Value:', ethers.formatEther(tx.value), 'ETH');
        console.log('Gas Limit:', tx.gasLimit.toString());
        console.log('Gas Price:', ethers.formatUnits(tx.gasPrice || 0n, 'gwei'), 'gwei');
        console.log('Nonce:', tx.nonce);
        console.log('Data length:', tx.data.length, 'bytes');

        // Get receipt
        const receipt = await provider.getTransactionReceipt(txHash);
        if (!receipt) {
            console.log('\n⏳ Transaction is pending...');
            return;
        }

        console.log('\n📊 Transaction Receipt:');
        console.log('Status:', receipt.status === 1 ? '✅ Success' : '❌ Failed/Reverted');
        console.log('Block:', receipt.blockNumber);
        console.log('Gas Used:', receipt.gasUsed.toString());
        console.log('Effective Gas Price:', ethers.formatUnits(receipt.gasPrice, 'gwei'), 'gwei');

        if (receipt.status === 0) {
            console.log('\n🔴 Transaction REVERTED');

            // Try to get revert reason by replaying the transaction
            try {
                console.log('\n🔄 Attempting to replay transaction to get revert reason...');

                await provider.call({
                    from: tx.from,
                    to: tx.to,
                    data: tx.data,
                    value: tx.value,
                    gasLimit: tx.gasLimit
                }, receipt.blockNumber - 1); // Call at previous block

                console.log('⚠️ Replay succeeded (unexpected)');
            } catch (error: any) {
                console.log('\n❗ Revert Reason:');

                if (error.data) {
                    // Try to decode the error
                    const errorData = error.data;
                    console.log('Raw error data:', errorData);

                    // Common GMX error signatures
                    const gmxErrors: Record<string, string> = {
                        '0x4e487b71': 'Panic (assert/overflow/underflow)',
                        '0x08c379a0': 'Error(string)',
                        '0x365a86f0': 'InsufficientCollateral',
                        '0x3d0c5b5f': 'PositionNotLiquidatable',
                        '0x6d8e6c14': 'InvalidPosition',
                    };

                    const errorSig = errorData.slice(0, 10);
                    if (gmxErrors[errorSig]) {
                        console.log('Error type:', gmxErrors[errorSig]);
                    } else {
                        console.log('Unknown error signature:', errorSig);
                    }

                    // Try to decode Error(string)
                    if (errorSig === '0x08c379a0') {
                        try {
                            const reason = ethers.AbiCoder.defaultAbiCoder().decode(
                                ['string'],
                                '0x' + errorData.slice(10)
                            );
                            console.log('Decoded message:', reason[0]);
                        } catch (e) {
                            console.log('Could not decode error message');
                        }
                    }
                }

                console.log('\nFull error:', error.message);
            }
        }

        // Decode transaction data
        console.log('\n📝 Decoding liquidation call data...');
        const iface = new ethers.Interface([
            'function multicall(bytes[] calldata data) returns (bytes[] memory)',
            'function executeLiquidation(address account, address market, address collateralToken, bool isLong, address feeReceiver)'
        ]);

        try {
            const decoded = iface.parseTransaction({ data: tx.data });
            console.log('Function:', decoded?.name);
            console.log('Arguments:', decoded?.args);
        } catch (e) {
            console.log('Could not decode function call');
        }

    } catch (error: any) {
        console.error('Error analyzing transaction:', error.message);
    }
}

analyzeTx();
