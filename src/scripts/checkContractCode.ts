import { ethers } from 'ethers';

const RPC_URL = 'https://arb1.arbitrum.io/rpc';
const READER_ADDRESS = '0x2F0b22339414ADeD7D5F06f9D604c7fF5b2fe3f6';

async function checkCode() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const code = await provider.getCode(READER_ADDRESS);
    console.log(`Code at ${READER_ADDRESS}:`, code === '0x' ? 'EMPTY' : `EXISTS (${code.length} bytes)`);
}

checkCode().catch(console.error);
