import { ethers } from 'ethers';

const READER_ADDRESS = '0x60a0fF4cDaF0f6D496d35a5B7E7f4e81e7bF4D23';

console.log('Original:', READER_ADDRESS);
try {
    const checksummed = ethers.getAddress(READER_ADDRESS.toLowerCase());
    console.log('Checksummed:', checksummed);
    console.log('Match:', READER_ADDRESS === checksummed);
} catch (error) {
    console.error('Error checksumming:', error);
}
