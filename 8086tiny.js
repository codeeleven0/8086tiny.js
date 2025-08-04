// 8086tiny: a tiny, highly functional, highly portable PC emulator/VM
// Copyright 2013-14, Adrian Cable (adrian.cable@gmail.com) - http://www.megalith.co.uk/8086tiny
//
// Revision 1.25
//
// Ported by codeeleven0
// This work is licensed under the MIT License. See included LICENSE.TXT.

// Emulator system constants
const IO_PORT_COUNT = 0x10000;
const RAM_SIZE = 0x10FFF0;
const REGS_BASE = 0xF0000;
const VIDEO_RAM_SIZE = 0x10000;

// Graphics/timer/keyboard update delays (explained later)
const GRAPHICS_UPDATE_DELAY = 360000;
const KEYBOARD_TIMER_UPDATE_DELAY = 20000;

// 16-bit register decodes
const REG_AX = 0;
const REG_CX = 1;
const REG_DX = 2;
const REG_BX = 3;
const REG_SP = 4;
const REG_BP = 5;
const REG_SI = 6;
const REG_DI = 7;

const REG_ES = 8;
const REG_CS = 9;
const REG_SS = 10;
const REG_DS = 11;

const REG_ZERO = 12;
const REG_SCRATCH = 13;

// 8-bit register decodes
const REG_AL = 0;
const REG_AH = 1;
const REG_CL = 2;
const REG_CH = 3;
const REG_DL = 4;
const REG_DH = 5;
const REG_BL = 6;
const REG_BH = 7;

// FLAGS register decodes
const FLAG_CF = 40;
const FLAG_PF = 41;
const FLAG_AF = 42;
const FLAG_ZF = 43;
const FLAG_SF = 44;
const FLAG_TF = 45;
const FLAG_IF = 46;
const FLAG_DF = 47;
const FLAG_OF = 48;

// Lookup tables in the BIOS binary
const TABLE_XLAT_OPCODE = 8;
const TABLE_XLAT_SUBFUNCTION = 9;
const TABLE_STD_FLAGS = 10;
const TABLE_PARITY_FLAG = 11;
const TABLE_BASE_INST_SIZE = 12;
const TABLE_I_W_SIZE = 13;
const TABLE_I_MOD_SIZE = 14;
const TABLE_COND_JUMP_DECODE_A = 15;
const TABLE_COND_JUMP_DECODE_B = 16;
const TABLE_COND_JUMP_DECODE_C = 17;
const TABLE_COND_JUMP_DECODE_D = 18;
const TABLE_FLAGS_BITFIELDS = 19;

// Bitfields for TABLE_STD_FLAGS values
const FLAGS_UPDATE_SZP = 1;
const FLAGS_UPDATE_AO_ARITH = 2;
const FLAGS_UPDATE_OC_LOGIC = 4;

// Macro preprocessor
var $_LOG = false;
const $ = (code, lookup) => {
	const macros = /\#\[.*?\]/gm;
    const occurences = Array.from(code.matchAll(macros)).map(n => Array.from(n.entries())[0][1]);
    for (const occurence of occurences) {
        const name = occurence.split("#[")[1].split("]")[0];
        let value = "";
        if (lookup[name] != undefined) {
            value = lookup[name].toString();
        } else {
            value = " ";
        }
        if ($_LOG) console.log(occurence + " => " + value.toString());
        code = code.replaceAll(occurence, value);
    }
	if ($_LOG) console.log(code);
    return code;
};

// Helper macros

// Decode mod, r_m and reg fields in instruction
const DECODE_RM_REG = () => {
    return eval("(() => { scratch2_uint = 4 * !i_mod; op_to_addr = rm_addr = i_mod < 3 ? SEGREG('seg_override_en ? seg_override : bios_table_lookup[scratch2_uint + 3][i_rm]', 'bios_table_lookup[scratch2_uint][i_rm]', 'regs16[bios_table_lookup[scratch2_uint + 1][i_rm]] + bios_table_lookup[scratch2_uint + 2][i_rm] * i_data1+') : GET_REG_ADDR('i_rm'); op_from_addr = GET_REG_ADDR('i_reg'); return i_d && (scratch_uint = op_from_addr, op_from_addr = rm_addr, op_to_addr = scratch_uint); })();");
};

// Return memory-mapped register location (offset into mem array) for register #reg_id
const GET_REG_ADDR = (reg_id) => {
    return eval($("(REGS_BASE + (i_w ? 2 * #[reg_id] : 2 * #[reg_id] + #[reg_id] / 4 & 7))", {"reg_id": reg_id}));
};

// Returns number of top bit in operand (i.e. 8 for 8-bit operands, 16 for 16-bit operands)
const TOP_BIT = () => {
    return eval("8*(i_w + 1)");
};

// Cast helper
const CAST_TABLE = {
    "unsigned short": Uint16Array,
    "unsigned char": Uint8Array,
    "short": Int16Array,
    "char": Int8Array,
    "unsigned": Int32Array
};

const CAST = (type, element) => {
    return ((new CAST_TABLE[type]([element]))[0]);
}

// Opcode execution unit helpers


// [I]MUL/[I]DIV/DAA/DAS/ADC/SBB helpers
const MUL_MACRO = (op_data_type, out_regs) => {
    return eval($("(() => { set_opcode(0x10); #[out_regs][i_w + 1] = (op_result = CAST('#[op_data_type]', mem[rm_addr]) * CAST('#[op_data_type]', #[out_regs][0])) >> 16; regs16[REG_AX] = op_result; return set_OF(set_CF(op_result - CAST('#[op_data_type]', op_result))) })()", {"op_data_type": op_data_type, "out_regs": out_regs}));
};
const DIV_MACRO = (out_data_type, in_data_type, out_regs) => {
    return eval($("(scratch_int = CAST('#[out_data_type]', mem[rm_addr])) && !(scratch2_uint = CAST('#[in_data_type]', Math.floor(CAST('#[in_data_type]', (scratch_uint = (#[out_regs][i_w+1] << 16) + regs16[REG_AX])) / CAST('#[in_data_type]', scratch_int))), scratch2_uint - CAST('#[out_data_type]', scratch2_uint)) ? #[out_regs][i_w+1] = scratch_uint - scratch_int * (#[out_regs][0] = scratch2_uint) : pc_interrupt(0)", {"out_data_type": out_data_type, "in_data_type": in_data_type, "out_regs": out_regs}));
};
const DAA_DAS = (op1, op2, mask, min) => {
    return eval($("(() => { set_AF((((scratch2_uint = regs8[REG_AL]) & 0x0F) > 9) || regs8[FLAG_AF]) && (op_result = regs8[REG_AL] #[op1] 6, set_CF(regs8[FLAG_CF] || (regs8[REG_AL] #[op2] scratch2_uint))); return set_CF((((#[mask] & 1 ? scratch2_uint : regs8[REG_AL]) & #[mask]) > #[min]) || regs8[FLAG_CF]) && (op_result = regs8[REG_AL] #[op1] 0x60); })()", {"op1": op1, "op2": op2, "mask": mask, "min": min}));
};
const ADC_SBB_MACRO = (a) => {
    return eval($("(() => { OP('#[a]= regs8[FLAG_CF] +'); set_CF(regs8[FLAG_CF] && (op_result == op_dest) || (#[a] op_result < (#[a] (new Int32Array([op_dest])[0])))); return set_AF_OF_arith(); })();", {"a": a}));
};

// Execute arithmetic/logic operations in emulator memory/registers
const R_M_OP = (dest, op, src) => {
    return eval($("(i_w ? (() => { op_dest = (new Uint16Array([#[dest]])[0]); return op_result = #[dest] #[op] (op_source = (new Uint16Array([#[src]])[0])) })() : (() => { op_dest = #[dest]; return op_result = #[dest] #[op] (op_source = (new Uint8Array([#[src]])[0])) })())", {"op": op, "src": src, "dest": dest}));
};
const MEM_OP = (dest, op, src) => {
    return eval($("R_M_OP('mem[#[dest]]', '#[op]', 'mem[#[src]]')", {"dest": dest, "op": op, "src": src}));
};
const OP = (op) => {
    return eval($("MEM_OP('op_to_addr', '#[op]', 'op_from_addr')", {"op": op}));
};

// Increment or decrement a register #reg_id (usually SI or DI), depending on direction flag and operand size (given by i_w)
const INDEX_INC = (reg_id) => {
    return eval($("(regs16[#[reg_id]] -= (2 * regs8[FLAG_DF] - 1)*(i_w + 1))", {"reg_id" : reg_id}));
};

// Helpers for stack operations
const R_M_PUSH = (a) => {
    return eval($('(i_w = 1, R_M_OP("mem[SEGREG(\\\'REG_SS\\\', \\\'REG_SP\\\', \\\'--\\\')]", "=", "#[a]"))', {"a": a}));
};
const R_M_POP = (a) => {
    return eval($('(i_w = 1, regs16[REG_SP] += 2, R_M_OP("#[a]", "=", "mem[SEGREG(\\\'REG_SS\\\', \\\'REG_SP\\\', \\\'-2+\\\')]"))', {"a": a}));
};
// Convert segment:offset to linear address in emulator memory space
const SEGREG = (reg_seg, reg_ofs, op) => {
    return eval($("16 * regs16[#[reg_seg]] + (new Uint16Array([(#[op] regs16[#[reg_ofs]])])[0])", {"op": op, "reg_seg": reg_seg, "reg_ofs": reg_ofs}));
};

// Returns sign bit of an 8-bit or 16-bit operand
const SIGN_OF = (a) => {
    return eval($("(1 & (i_w ? (new Int16Array([a])[0]) : (new Int8Array([a])[0])) >> (TOP_BIT() - 1))", {"a": a}));
};

// Keyboard driver for console. This may need changing for UNIX/non-UNIX platforms
const KEYBOARD_DRIVER = () => {
	return 'h';
};

// Keyboard driver for SDL
const SDL_KEYBOARD_DRIVER = KEYBOARD_DRIVER;

// Global variable definitions
var mem = new Uint8Array(RAM_SIZE);
var io_ports = new Uint8Array(IO_PORT_COUNT);
var opcode_stream = new Uint8Array();
var regs8 = mem.subarray(REGS_BASE);
var regs16 = new Uint16Array(mem.buffer, REGS_BASE, Math.floor((mem.length - REGS_BASE) / 2));

var reg_ip = 0;
var seg_override = 0;
var op_source = 0;
var op_dest = 0;
var rm_addr = 0;
var op_to_addr = 0;
var op_from_addr = 0;
var i_data0 = 0;
var i_data1 = 0;
var i_data2 = 0;
var scratch_uint = 0;
var scratch2_uint = 0;
var inst_counter = 0;
var set_flags_type = 0;
var op_result = 0;
var disk = Array(3).fill(null);
var i_rm = 0;
var i_w = 0;
var i_reg = 0;
var i_mod = 0;
var i_mod_size = 0;
var i_d = 0;
var i_reg4bit = 0;
var raw_opcode_id = 0;
var xlat_opcode_id = 0;
var extra = 0;
var rep_mode = 0;
var seg_override_en = 0;
var rep_override_en = 0;
var trap_flag = 0;
var int8_asap = 0;
var scratch_uchar = 0;
var io_hi_lo = 0;
var spkr_en = 0;

// Helper functions

// Set carry flag
function set_CF(new_CF){
	return regs8[FLAG_CF] = !!new_CF;
}

// Set auxiliary flag
function set_AF(new_AF){
	return regs8[FLAG_AF] = !!new_AF;
}

// Set overflow flag
function set_OF(new_OF){
	return regs8[FLAG_OF] = !!new_OF;
}

// Set auxiliary and overflow flag after arithmetic operations
function set_AF_OF_arith(){
	set_AF((op_source ^= op_dest ^ op_result) & 0x10);
	if (op_result == op_dest)
		return set_OF(0);
	else
		return set_OF(1 & (regs8[FLAG_CF] ^ op_source >> (TOP_BIT - 1)));
}

// Assemble and return emulated CPU FLAGS register in scratch_uint
function make_flags(){
	scratch_uint = 0xF002; // 8086 has reserved and unused flags set to 1
	for (let i = 9; i--;)
		scratch_uint += regs8[FLAG_CF + i] << bios_table_lookup[TABLE_FLAGS_BITFIELDS][i];
}

// Set emulated CPU FLAGS register from regs8[FLAG_xx] values
function set_flags(new_flags){
	for (let i = 9; i--;)
		regs8[FLAG_CF + i] = !!(1 << bios_table_lookup[TABLE_FLAGS_BITFIELDS][i] & new_flags);
}

// Convert raw opcode to translated opcode index. This condenses a large number of different encodings of similar
// instructions into a much smaller number of distinct functions, which we then execute
function set_opcode(opcode){
	xlat_opcode_id = bios_table_lookup[TABLE_XLAT_OPCODE][raw_opcode_id = opcode];
	extra = bios_table_lookup[TABLE_XLAT_SUBFUNCTION][opcode];
	i_mod_size = bios_table_lookup[TABLE_I_MOD_SIZE][opcode];
	set_flags_type = bios_table_lookup[TABLE_STD_FLAGS][opcode];
}

// Execute INT #interrupt_num on the emulated machine
function pc_interrupt(interrupt_num){
	set_opcode(0xCD); // Decode like INT

	make_flags();
	R_M_PUSH('scratch_uint');
	R_M_PUSH('regs16[REG_CS]');
	R_M_PUSH('reg_ip');
	MEM_OP('REGS_BASE + 2 * REG_CS', '=', `4 * ${interrupt_num} + 2`);
	R_M_OP('reg_ip', '=', `mem[4 * ${interrupt_num}]`);

	return regs8[FLAG_TF] = regs8[FLAG_IF] = 0;
}

// AAA and AAS instructions - which_operation is +1 for AAA, and -1 for AAS
function AAA_AAS(which_operation){
	return (regs16[REG_AX] += 262 * which_operation*set_AF(set_CF(((regs8[REG_AL] & 0x0F) > 9) || regs8[FLAG_AF])), regs8[REG_AL] &= 0x0F);
}

// BIOS instruction decoding helper table
const bios_table_lookup = [[3, 3, 5, 5, 6, 7, 5, 3, 1, 1, 1, 1, 1, 1, 1, 1, 11, 11, 10, 10, 11, 11, 10, 11, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 25, 48, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 27, 28, 9, 9, 9, 9, 7, 7, 27, 28, 9, 9, 9, 9, 7, 7, 27, 29, 9, 9, 9, 9, 7, 7, 27, 29, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 51, 54, 52, 52, 52, 52, 52, 52, 55, 55, 55, 55, 52, 52, 52, 52, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 8, 8, 8, 15, 15, 24, 24, 9, 9, 9, 9, 10, 10, 10, 10, 16, 16, 16, 16, 16, 16, 16, 16, 30, 31, 32, 53, 33, 34, 35, 36, 11, 11, 11, 11, 17, 17, 18, 18, 47, 47, 17, 17, 17, 17, 18, 18, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 12, 19, 19, 37, 37, 20, 20, 49, 50, 19, 19, 38, 39, 40, 19, 12, 12, 12, 12, 41, 42, 43, 44, 53, 53, 53, 53, 53, 53, 53, 53, 13, 13, 13, 13, 21, 21, 22, 22], [6, 7, 6, 7, 12, 12, 12, 12, 0, 0, 0, 0, 0, 0, 1, 0, 11, 11, 10, 10, 11, 11, 11, 11, 3, 3, 5, 5, 6, 7, 5, 3, 1, 1, 1, 1, 1, 1, 1, 1, 11, 11, 10, 10, 11, 11, 10, 11, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 25, 48, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 27, 28, 9, 9, 9, 9, 7, 7, 27, 28, 9, 9, 9, 9, 7, 7, 27, 29, 9, 9, 9, 9, 7, 7, 27, 29, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 51, 54, 52, 52, 52, 52, 52, 52, 55, 55, 55, 55, 52, 52, 52, 52, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 8, 8, 8, 15, 15, 24, 24, 9, 9, 9, 9, 10, 10, 10, 10, 16, 16, 16, 16, 16, 16, 16, 16, 30, 31, 32, 53, 33, 34, 35, 36, 11, 11, 11, 11, 17, 17, 18, 18, 47, 47, 17, 17, 17, 17, 18, 18, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 12, 19, 19, 37, 37, 20, 20, 49, 50, 19, 19, 38, 39, 40, 19], [1, 1, 1, 1, 1, 1, 1, 1, 11, 11, 10, 10, 11, 11, 10, 11, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 25, 48, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 27, 28, 9, 9, 9, 9, 7, 7, 27, 28, 9, 9, 9, 9, 7, 7, 27, 29, 9, 9, 9, 9, 7, 7, 27, 29, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 51, 54, 52, 52, 52, 52, 52, 52, 55, 55, 55, 55, 52, 52, 52, 52, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 8, 8, 8, 15, 15, 24, 24, 9, 9, 9, 9, 10, 10, 10, 10, 16, 16, 16, 16, 16, 16, 16, 16, 30, 31, 32, 53, 33, 34, 35, 36, 11, 11, 11, 11, 17, 17, 18, 18, 47, 47, 17, 17, 17, 17, 18, 18, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 12, 19, 19, 37, 37, 20, 20, 49, 50, 19, 19, 38, 39, 40, 19, 12, 12, 12, 12, 41, 42, 43, 44, 53, 53, 53, 53, 53, 53, 53, 53, 13, 13, 13, 13, 21, 21, 22, 22, 14, 14, 14, 14, 21, 21, 22, 22], [11, 11, 10, 10, 11, 11, 10, 11, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 25, 48, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 27, 28, 9, 9, 9, 9, 7, 7, 27, 28, 9, 9, 9, 9, 7, 7, 27, 29, 9, 9, 9, 9, 7, 7, 27, 29, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 51, 54, 52, 52, 52, 52, 52, 52, 55, 55, 55, 55, 52, 52, 52, 52, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 8, 8, 8, 15, 15, 24, 24, 9, 9, 9, 9, 10, 10, 10, 10, 16, 16, 16, 16, 16, 16, 16, 16, 30, 31, 32, 53, 33, 34, 35, 36, 11, 11, 11, 11, 17, 17, 18, 18, 47, 47, 17, 17, 17, 17, 18, 18, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 12, 19, 19, 37, 37, 20, 20, 49, 50, 19, 19, 38, 39, 40, 19, 12, 12, 12, 12, 41, 42, 43, 44, 53, 53, 53, 53, 53, 53, 53, 53, 13, 13, 13, 13, 21, 21, 22, 22, 14, 14, 14, 14, 21, 21, 22, 22, 53, 0, 23, 23, 53, 45, 6, 6], [3, 3, 5, 5, 6, 7, 12, 3, 6, 7, 6, 7, 12, 12, 12, 12, 0, 0, 0, 0, 0, 0, 1, 0, 11, 11, 10, 10, 11, 11, 11, 11, 3, 3, 5, 5, 6, 7, 5, 3, 1, 1, 1, 1, 1, 1, 1, 1, 11, 11, 10, 10, 11, 11, 10, 11, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 25, 48, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 27, 28, 9, 9, 9, 9, 7, 7, 27, 28, 9, 9, 9, 9, 7, 7, 27, 29, 9, 9, 9, 9, 7, 7, 27, 29, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 51, 54, 52, 52, 52, 52, 52, 52, 55, 55, 55, 55, 52, 52, 52, 52, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 8, 8, 8, 15, 15, 24, 24, 9, 9, 9, 9, 10, 10, 10, 10, 16, 16, 16, 16, 16, 16, 16, 16, 30, 31, 32, 53, 33, 34, 35, 36, 11, 11, 11, 11, 17, 17, 18, 18, 47, 47, 17, 17, 17, 17, 18, 18, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 12, 19, 19, 37, 37, 20, 20], [6, 7, 6, 7, 12, 12, 12, 12, 0, 0, 0, 0, 0, 0, 1, 0, 11, 11, 10, 10, 11, 11, 11, 11, 3, 3, 5, 5, 6, 7, 5, 3, 1, 1, 1, 1, 1, 1, 1, 1, 11, 11, 10, 10, 11, 11, 10, 11, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 25, 48, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 27, 28, 9, 9, 9, 9, 7, 7, 27, 28, 9, 9, 9, 9, 7, 7, 27, 29, 9, 9, 9, 9, 7, 7, 27, 29, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 51, 54, 52, 52, 52, 52, 52, 52, 55, 55, 55, 55, 52, 52, 52, 52, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 8, 8, 8, 15, 15, 24, 24, 9, 9, 9, 9, 10, 10, 10, 10, 16, 16, 16, 16, 16, 16, 16, 16, 30, 31, 32, 53, 33, 34, 35, 36, 11, 11, 11, 11, 17, 17, 18, 18, 47, 47, 17, 17, 17, 17, 18, 18, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 12, 19, 19, 37, 37, 20, 20, 49, 50, 19, 19, 38, 39, 40, 19], [0, 0, 0, 0, 0, 0, 1, 0, 11, 11, 10, 10, 11, 11, 11, 11, 3, 3, 5, 5, 6, 7, 5, 3, 1, 1, 1, 1, 1, 1, 1, 1, 11, 11, 10, 10, 11, 11, 10, 11, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 25, 48, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 27, 28, 9, 9, 9, 9, 7, 7, 27, 28, 9, 9, 9, 9, 7, 7, 27, 29, 9, 9, 9, 9, 7, 7, 27, 29, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 51, 54, 52, 52, 52, 52, 52, 52, 55, 55, 55, 55, 52, 52, 52, 52, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 8, 8, 8, 15, 15, 24, 24, 9, 9, 9, 9, 10, 10, 10, 10, 16, 16, 16, 16, 16, 16, 16, 16, 30, 31, 32, 53, 33, 34, 35, 36, 11, 11, 11, 11, 17, 17, 18, 18, 47, 47, 17, 17, 17, 17, 18, 18, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 12, 19, 19, 37, 37, 20, 20, 49, 50, 19, 19, 38, 39, 40, 19, 12, 12, 12, 12, 41, 42, 43, 44], [11, 11, 10, 10, 11, 11, 11, 11, 3, 3, 5, 5, 6, 7, 5, 3, 1, 1, 1, 1, 1, 1, 1, 1, 11, 11, 10, 10, 11, 11, 10, 11, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 25, 48, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 27, 28, 9, 9, 9, 9, 7, 7, 27, 28, 9, 9, 9, 9, 7, 7, 27, 29, 9, 9, 9, 9, 7, 7, 27, 29, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 51, 54, 52, 52, 52, 52, 52, 52, 55, 55, 55, 55, 52, 52, 52, 52, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 8, 8, 8, 15, 15, 24, 24, 9, 9, 9, 9, 10, 10, 10, 10, 16, 16, 16, 16, 16, 16, 16, 16, 30, 31, 32, 53, 33, 34, 35, 36, 11, 11, 11, 11, 17, 17, 18, 18, 47, 47, 17, 17, 17, 17, 18, 18, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 12, 19, 19, 37, 37, 20, 20, 49, 50, 19, 19, 38, 39, 40, 19, 12, 12, 12, 12, 41, 42, 43, 44, 53, 53, 53, 53, 53, 53, 53, 53], [9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 25, 48, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 25, 26, 9, 9, 9, 9, 7, 7, 27, 28, 9, 9, 9, 9, 7, 7, 27, 28, 9, 9, 9, 9, 7, 7, 27, 29, 9, 9, 9, 9, 7, 7, 27, 29, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 51, 54, 52, 52, 52, 52, 52, 52, 55, 55, 55, 55, 52, 52, 52, 52, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 8, 8, 8, 15, 15, 24, 24, 9, 9, 9, 9, 10, 10, 10, 10, 16, 16, 16, 16, 16, 16, 16, 16, 30, 31, 32, 53, 33, 34, 35, 36, 11, 11, 11, 11, 17, 17, 18, 18, 47, 47, 17, 17, 17, 17, 18, 18, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12, 12, 19, 19, 37, 37, 20, 20, 49, 50, 19, 19, 38, 39, 40, 19, 12, 12, 12, 12, 41, 42, 43, 44, 53, 53, 53, 53, 53, 53, 53, 53, 13, 13, 13, 13, 21, 21, 22, 22, 14, 14, 14, 14, 21, 21, 22, 22, 53, 0, 23, 23, 53, 45, 6, 6, 46, 46, 46, 46, 46, 46, 5, 5], [0, 0, 0, 0, 0, 0, 8, 8, 1, 1, 1, 1, 1, 1, 9, 36, 2, 2, 2, 2, 2, 2, 10, 10, 3, 3, 3, 3, 3, 3, 11, 11, 4, 4, 4, 4, 4, 4, 8, 0, 5, 5, 5, 5, 5, 5, 9, 1, 6, 6, 6, 6, 6, 6, 10, 2, 7, 7, 7, 7, 7, 7, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 21, 21, 21, 21, 21, 21, 0, 0, 0, 0, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 0, 0, 0, 0, 0, 0, 0, 0, 8, 8, 8, 8, 12, 12, 12, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 16, 22, 0, 0, 0, 0, 1, 1, 0, 255, 48, 2, 0, 0, 0, 0, 255, 255, 40, 11, 3, 3, 3, 3, 3, 3, 3, 3, 43, 43, 43, 43, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 21, 0, 0, 2, 40, 21, 21, 80, 81, 92, 93, 94, 95, 0, 0], [3, 3, 3, 3, 3, 3, 0, 0, 5, 5, 5, 5, 5, 5, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 5, 5, 5, 5, 5, 5, 0, 1, 3, 3, 3, 3, 3, 3, 0, 1, 5, 5, 5, 5, 5, 5, 0, 1, 3, 3, 3, 3, 3, 3, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1], [2, 2, 2, 2, 1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 3, 0, 0, 2, 2, 2, 2, 4, 1, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 1, 1, 2, 2], [0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1], [48, 40, 43, 40, 44, 41, 49, 49, 49, 49, 49, 43, 49, 49, 49, 43, 49, 49, 49, 49, 49, 49, 44, 44, 49, 49, 49, 49, 49, 49, 48, 48, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0], [49, 49, 49, 43, 49, 49, 49, 43, 49, 49, 49, 49, 49, 49, 44, 44, 49, 49, 49, 49, 49, 49, 48, 48, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1], [49, 49, 49, 49, 49, 49, 44, 44, 49, 49, 49, 49, 49, 49, 48, 48, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0], [49, 49, 49, 49, 49, 49, 48, 48, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0], [0, 2, 4, 6, 7, 8, 9, 10, 11, 48, 40, 43, 40, 44, 41, 49, 49, 49, 49, 49, 43, 49, 49, 49, 43, 49, 49, 49, 49, 49, 49, 44, 44, 49, 49, 49, 49, 49, 49, 48, 48, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0]];


// struct tm equivalent
const localtime = () => {
    let doy = (d) => {
        return Math.ceil(((new Date(d)) - (new Date(d.getUTCFullYear(), 0, 1)) + 1) / 86400000);
    };
    let date = new Date();
    
    // 4 bytes for each = 4 * 10 = 40 bytes
    let buffer = new Uint8Array(40);
    let tm_sec = new Uint8Array(new Uint32Array([date.getUTCSeconds()]).buffer);
    let tm_min = new Uint8Array(new Uint32Array([date.getUTCMinutes()]).buffer);
    let tm_hour = new Uint8Array(new Uint32Array([date.getUTCHours()]).buffer);
    let tm_mday = new Uint8Array(new Uint32Array([date.getUTCDate()]).buffer);
    let tm_mon = new Uint8Array(new Uint32Array([date.getUTCMonth()]).buffer);
    let tm_year = new Uint8Array(new Uint32Array([date.getUTCFullYear() - 1900]).buffer);
    let tm_wday = new Uint8Array(new Uint32Array([date.getUTCDay()]).buffer);
    let tm_yday = new Uint8Array(new Uint32Array([doy(date)]).buffer);
    let tm_dst = new Uint8Array(new Uint32Array([0]).buffer);
    let tm_msec = new Uint8Array(new Uint32Array([date.getUTCMilliseconds()]).buffer);
    let fields = [tm_sec, tm_min, tm_hour, tm_mday, tm_mon, tm_year, tm_wday, tm_yday, tm_dst, tm_msec];
    let i = 0;

    for (let field of fields) {
        for (let subfield of field) {
            buffer[i] = subfield;
            i++;
        }
    }

    return buffer;
};

// Emulator entry point
const fs = require("fs");
const process = require("process");
const BIOS = "bios"; // BIOS file name
var O_LOG = false;
function main(){
	// regs16 and reg8 point to F000:0, the start of memory-mapped registers. CS is initialised to F000
	// regs16 = (unsigned short *)(regs8 = mem + REGS_BASE);

	// Set DL equal to the boot device: 0 for the FD, or 0x80 for the HD. Normally, boot from the FD.
	// But, if the HD image file is prefixed with @, then boot from the HD
	// regs8[REG_DL] = ((argc > 3) && (argv[3].charCodeAt(0) == '@')) ? argv[3]++, 0x80 : 0;

	// Open BIOS (file id disk[2]), floppy disk image (disk[1]), and hard disk image (disk[0]) if specified
	// for (file_index = 3; file_index;)
	//     disk[--file_index] = *++argv ? open(*argv, 32898) : 0;

	// Set CX:AX equal to the hard disk image size, if present
	// regs16[REG_AX] = disk[0] ? lseek(disk[0], 0, 2) >> 9 : 0;

	// Load BIOS image into F000:0100, and set IP to 0100
	// read(disk[2], regs8 + (reg_ip = 0x100), 0xFF00);

	regs16[REG_CS] = 0xf000;
	regs8[REG_DL] = 0x80;
	regs16[REG_AX] = 0;
	reg_ip = 0x100;
	
	// Trap flag off
	regs8[FLAG_TF] = 0;

	var bios = null;
	try {
		bios = fs.readFileSync(BIOS);
	} catch {
		return 1;
	}
	
	for (let i = 0; i < bios.length && i < 0xff00; i++){
		mem[(regs16[REG_CS] * 16) + reg_ip + i] = bios[i];
	}
	console.log(`loaded bios @ ${regs16[REG_CS].toString(16).padStart(4, "0")}:${reg_ip.toString(16).padStart(4, "0")}, size=${((0xff00 - bios.length) ? bios.length : 0xff00).toString(16).padStart(4, "0")}`);
	console.log(`expected bios end @ ${regs16[REG_CS].toString(16).padStart(4, "0")}:${(reg_ip + ((0xff00 - bios.length) ? bios.length : 0xff00)).toString(16).padStart(4, "0")}`);
	console.log(`booting @ ${regs16[REG_CS].toString(16).padStart(4, "0")}:${reg_ip.toString(16).padStart(4, "0")}`);
	let step = 0;
	// Instruction execution loop. Terminates if CS:IP = 0:0
	while (true && ((regs16[REG_CS] != 0) && (reg_ip != 0) && (reg_ip == 0xffff || reg_ip == (reg_ip & 0xffff)) && (regs16[REG_CS] == 0xffff || regs16[REG_CS] == (regs16[REG_CS] & 0xffff)))){
		opcode_stream = mem.slice((16 * regs16[REG_CS]) + reg_ip, mem.length);
		if (O_LOG) console.log(`running @ ${regs16[REG_CS].toString(16).padStart(4, "0")}:${reg_ip.toString(16).padStart(4, "0")}, step=${step}`);
		// Set up variables to prepare for decoding an opcode
		set_opcode(opcode_stream[0]);
		step++;
		// Extract i_w and i_d fields from instruction
		i_w = (i_reg4bit = raw_opcode_id & 7) & 1;
		i_d = i_reg4bit / 2 & 1;

		// Extract instruction data fields
		i_data0 = (new Int16Array([opcode_stream[1]])[0]);
		i_data1 = (new Int16Array([opcode_stream[2]])[0]);
		i_data2 = (new Int16Array([opcode_stream[3]])[0]);

		// seg_override_en and rep_override_en contain number of instructions to hold segment override and REP prefix respectively
		if (seg_override_en)
			seg_override_en--;
		if (rep_override_en)
			rep_override_en--;

		// i_mod_size > 0 indicates that opcode uses i_mod/i_rm/i_reg, so decode them
		if (i_mod_size)
		{
			i_mod = (i_data0 & 0xFF) >> 6;
			i_rm = i_data0 & 7;
			i_reg = i_data0 / 8 & 7;

			if ((!i_mod && i_rm == 6) || (i_mod == 2))
				i_data2 = (new Int16Array([opcode_stream[4]])[0]);
			else if (i_mod != 1)
				i_data2 = i_data1;
			else // If i_mod is 1, operand is (usually) 8 bits rather than 16 bits
				i_data1 = (new Int8Array([i_data1])[0]);

			DECODE_RM_REG();
		}
		// Instruction execution unit
		switch (xlat_opcode_id)
		{
			case 0: // Conditional jump (JAE, JNAE, etc.)
				// i_w is the invert flag, e.g. i_w == 1 means JNAE, whereas i_w == 0 means JAE 
				scratch_uchar = raw_opcode_id / 2 & 7;
				reg_ip += (new Int8Array([i_data0])[0]) * (i_w ^ (regs8[bios_table_lookup[TABLE_COND_JUMP_DECODE_A][scratch_uchar]] || regs8[bios_table_lookup[TABLE_COND_JUMP_DECODE_B][scratch_uchar]] || regs8[bios_table_lookup[TABLE_COND_JUMP_DECODE_C][scratch_uchar]] ^ regs8[bios_table_lookup[TABLE_COND_JUMP_DECODE_D][scratch_uchar]]))
			;break; case 1: // MOV reg, imm
				i_w = !!(raw_opcode_id & 8);
				R_M_OP('mem[GET_REG_ADDR("i_reg4bit")]', '=', 'i_data0')
			;break; case 3: // PUSH regs16
				R_M_PUSH('regs16[i_reg4bit]')
			;break; case 4: // POP regs16
				R_M_POP('regs16[i_reg4bit]')
			;break; case 2: // INC|DEC regs16
				i_w = 1;
				i_d = 0;
				i_reg = i_reg4bit;
				DECODE_RM_REG();
				i_reg = extra
			; case 5: // INC|DEC|JMP|CALL|PUSH
				if (i_reg < 2) // INC|DEC
					MEM_OP('op_from_addr', '+= 1 - 2 * i_reg +', 'REGS_BASE + 2 * REG_ZERO'),
					op_source = 1,
					set_AF_OF_arith(),
					set_OF(op_dest + 1 - i_reg == 1 << (TOP_BIT - 1)),
					(xlat_opcode_id == 5) && (set_opcode(0x10), 0); // Decode like ADC
				else if (i_reg != 6) // JMP|CALL
					i_reg - 3 || R_M_PUSH('regs16[REG_CS]'), // CALL (far)
					i_reg & 2 && R_M_PUSH('reg_ip + 2 + i_mod*(i_mod != 3) + 2*(!i_mod && i_rm == 6)'), // CALL (near or far)
					i_reg & 1 && (regs16[REG_CS] = (new Int16Array([mem[op_from_addr + 2]])[0])), // JMP|CALL (far)
					R_M_OP('reg_ip', '=', 'mem[op_from_addr]'),
					set_opcode(0x9A); // Decode like CALL
				else // PUSH
					R_M_PUSH('mem[rm_addr]')
			;break; case 6: // TEST r/m, imm16 / NOT|NEG|MUL|IMUL|DIV|IDIV reg
				op_to_addr = op_from_addr;

				switch (i_reg)
				{
					case 0: // TEST
						set_opcode(0x20); // Decode like AND
						reg_ip += i_w + 1;
						R_M_OP('mem[op_to_addr]', '&', 'i_data2')
					;break; case 2: // NOT
						OP('=~')
					;break; case 3: // NEG
						OP('=-');
						op_dest = 0;
						set_opcode(0x28); // Decode like SUB
						set_CF(op_result > op_dest)
					;break; case 4: // MUL
						i_w ? MUL_MACRO("unsigned short", "regs16") : MUL_MACRO("unsigned char", "regs8")
					;break; case 5: // IMUL
						i_w ? MUL_MACRO("short", "regs16") : MUL_MACRO("char", "regs8")
					;break; case 6: // DIV
						i_w ? DIV_MACRO("unsigned short", "unsigned", "regs16") : DIV_MACRO("unsigned char", "unsigned short", "regs8")
					;break; case 7: // IDIV
						i_w ? DIV_MACRO("short", "int", "regs16") : DIV_MACRO("char", "short", "regs8");
				}
			;break; case 7: // ADD|OR|ADC|SBB|AND|SUB|XOR|CMP AL/AX, immed
				rm_addr = REGS_BASE;
				i_data2 = i_data0;
				i_mod = 3;
				i_reg = extra;
				reg_ip--;
			; case 8: // ADD|OR|ADC|SBB|AND|SUB|XOR|CMP reg, immed
				op_to_addr = rm_addr;
				regs16[REG_SCRATCH] = (i_d |= !i_w) ? (new Int8Array([i_data2])[0]) : i_data2;
				op_from_addr = REGS_BASE + 2 * REG_SCRATCH;
				reg_ip += !i_d + 1;
				set_opcode(0x08 * (extra = i_reg));
			; case 9: // ADD|OR|ADC|SBB|AND|SUB|XOR|CMP|MOV reg, r/m
				switch (extra)
				{
					case 0: // ADD
						OP('+='),
						set_CF(op_result < op_dest)
					;break; case 1: // OR
						OP('|=')
					;break; case 2: // ADC
						ADC_SBB_MACRO('+')
					;break; case 3: // SBB
						ADC_SBB_MACRO('-')
					;break; case 4: // AND
						OP('&=')
					;break; case 5: // SUB
						OP('-='),
						set_CF(op_result > op_dest)
					;break; case 6: // XOR
						OP('^=')
					;break; case 7: // CMP
						OP('-'),
						set_CF(op_result > op_dest)
					;break; case 8: // MOV
						OP('=');
				}
			;break; case 10: // MOV sreg, r/m | POP r/m | LEA reg, r/m
				if (!i_w) // MOV
					i_w = 1,
					i_reg += 8,
					DECODE_RM_REG(),
					OP('=');
				else if (!i_d) // LEA
					seg_override_en = 1,
					seg_override = REG_ZERO,
					DECODE_RM_REG(),
					R_M_OP('mem[op_from_addr]', '=', 'rm_addr');
				else // POP
					R_M_POP('mem[rm_addr]')
			;break; case 11: // MOV AL/AX, [loc]
				i_mod = i_reg = 0;
				i_rm = 6;
				i_data1 = i_data0;
				DECODE_RM_REG();
				MEM_OP('op_from_addr', '=', 'op_to_addr')
			;break; case 12: // ROL|ROR|RCL|RCR|SHL|SHR|???|SAR reg/mem, 1/CL/imm (80186)
				scratch2_uint = SIGN_OF('mem[rm_addr]'),
				scratch_uint = extra ? // xxx reg/mem, imm
					(() => { ++reg_ip; return (new Int8Array([i_data1])[0]); })()
				: // xxx reg/mem, CL
					i_d
						? 31 & regs8[REG_CL]
				: // xxx reg/mem, 1
					1;
				if (scratch_uint)
				{
					if (i_reg < 4) // Rotate operations
						scratch_uint %= i_reg / 2 + TOP_BIT(),
						R_M_OP('scratch2_uint','=', 'mem[rm_addr]');
					if (i_reg & 1) // Rotate/shift right operations
						R_M_OP('mem[rm_addr]', '>>=', 'scratch_uint');
					else // Rotate/shift left operations
						R_M_OP('mem[rm_addr]', '<<=', 'scratch_uint');
					if (i_reg > 3) // Shift operations
						set_opcode(0x10); // Decode like ADC
					if (i_reg > 4) // SHR or SAR
						set_CF(op_dest >> (scratch_uint - 1) & 1);
				}

				switch (i_reg)
				{
					case 0: // ROL
						R_M_OP('mem[rm_addr]',' += ', 'scratch2_uint >> (TOP_BIT() - scratch_uint)');
						set_OF(SIGN_OF('op_result') ^ set_CF(op_result & 1))
					;break; case 1: // ROR
						scratch2_uint &= (1 << scratch_uint) - 1,
						R_M_OP('mem[rm_addr]', '+=', 'scratch2_uint << (TOP_BIT() - scratch_uint)');
						set_OF(SIGN_OF('op_result * 2') ^ set_CF(SIGN_OF('op_result')))
					;break; case 2: // RCL
						R_M_OP('mem[rm_addr]', '+= (regs8[FLAG_CF] << (scratch_uint - 1)) + ', 'scratch2_uint >> (1 + TOP_BIT() - scratch_uint)');
						set_OF(SIGN_OF('op_result') ^ set_CF(scratch2_uint & 1 << (TOP_BIT() - scratch_uint)))
					;break; case 3: // RCR
						R_M_OP('mem[rm_addr]', '+= (regs8[FLAG_CF] << (TOP_BIT - scratch_uint)) + ', 'scratch2_uint << (1 + TOP_BIT() - scratch_uint)');
						set_CF(scratch2_uint & 1 << (scratch_uint - 1));
						set_OF(SIGN_OF('op_result') ^ SIGN_OF('op_result * 2'))
					;break; case 4: // SHL
						set_OF(SIGN_OF('op_result') ^ set_CF(SIGN_OF('op_dest << (scratch_uint - 1)')))
					;break; case 5: // SHR
						set_OF(SIGN_OF('op_dest'))
					;break; case 7: // SAR
						scratch_uint < TOP_BIT() || set_CF(scratch2_uint);
						set_OF(0);
						R_M_OP('mem[rm_addr]', '+=', 'scratch2_uint *= ~(((1 << TOP_BIT()) - 1) >> scratch_uint)');
				}
			;break; case 13: // LOOPxx|JCZX
				scratch_uint = !!--regs16[REG_CX];

				switch(i_reg4bit)
				{
					case 0: // LOOPNZ
						scratch_uint &= !regs8[FLAG_ZF]
					;break; case 1: // LOOPZ
						scratch_uint &= regs8[FLAG_ZF]
					;break; case 3: // JCXXZ
						scratch_uint = !++regs16[REG_CX];
				}
				reg_ip += scratch_uint*(new Int8Array([i_data0])[0])
			;break; case 14: // JMP | CALL short/near
				reg_ip += 3 - i_d;
				if (!i_w)
				{
					if (i_d) // JMP far
						reg_ip = 0,
						regs16[REG_CS] = i_data2;
					else // CALL
						R_M_PUSH(reg_ip);
				}
				reg_ip += i_d && i_w ? (new Int8Array([i_data0])[0]) : i_data0
			;break; case 15: // TEST reg, r/m
				MEM_OP('op_from_addr', '&', 'op_to_addr')
			;break; case 16: // XCHG AX, regs16
				i_w = 1;
				op_to_addr = REGS_BASE;
				op_from_addr = GET_REG_ADDR('i_reg4bit');
			; case 24: // NOP|XCHG reg, r/m
				if (op_to_addr != op_from_addr)
					OP('^='),
					MEM_OP('op_from_addr', '^=', 'op_to_addr'),
					OP('^=')
			;break; case 17: // MOVSx (extra=0)|STOSx (extra=1)|LODSx (extra=2)
				scratch2_uint = seg_override_en ? seg_override : REG_DS;

				for (scratch_uint = rep_override_en ? regs16[REG_CX] : 1; scratch_uint; scratch_uint--)
				{
					MEM_OP('extra < 2 ? SEGREG("REG_ES", "REG_DI", "") : REGS_BASE', '=', 'extra & 1 ? REGS_BASE : SEGREG("scratch2_uint", "REG_SI", "")'),
					extra & 1 || INDEX_INC('REG_SI'),
					extra & 2 || INDEX_INC('REG_DI');
				}

				if (rep_override_en)
					regs16[REG_CX] = 0
			;break; case 18: // CMPSx (extra=0)|SCASx (extra=1)
				scratch2_uint = seg_override_en ? seg_override : REG_DS;

				if ((scratch_uint = rep_override_en ? regs16[REG_CX] : 1))
				{
					for (; scratch_uint; rep_override_en || scratch_uint--)
					{
						MEM_OP('extra ? REGS_BASE : SEGREG("scratch2_uint", "REG_SI", "")', '-', 'SEGREG("REG_ES", "REG_DI", "")'),
						extra || INDEX_INC('REG_SI'),
						INDEX_INC('REG_DI'), rep_override_en && !(--regs16[REG_CX] && (!op_result == rep_mode)) && (scratch_uint = 0);
					}

					set_flags_type = FLAGS_UPDATE_SZP | FLAGS_UPDATE_AO_ARITH; // Funge to set SZP/AO flags
					set_CF(op_result > op_dest);
				}
			;break; case 19: // RET|RETF|IRET
				i_d = i_w;
				R_M_POP('reg_ip');
				if (extra) // IRET|RETF|RETF imm16
					R_M_POP('regs16[REG_CS]');
				if (extra & 2) // IRET
					set_flags(R_M_POP('scratch_uint'));
				else if (!i_d) // RET|RETF imm16
					regs16[REG_SP] += i_data0
			;break; case 20: // MOV r/m, immed
				R_M_OP('mem[op_from_addr]', '=', 'i_data2')
			;break; case 21: // IN AL/AX, DX/imm8
				io_ports[0x20] = 0; // PIC EOI
				io_ports[0x42] = --io_ports[0x40]; // PIT channel 0/2 read placeholder
				io_ports[0x3DA] ^= 9; // CGA refresh
				scratch_uint = extra ? regs16[REG_DX] : (new Uint8Array([i_data0])[0]);
				scratch_uint == 0x60 && (io_ports[0x64] = 0); // Scancode read flag
				scratch_uint == 0x3D5 && (io_ports[0x3D4] >> 1 == 7) && (io_ports[0x3D5] = ((mem[0x49E]*80 + mem[0x49D] + (new Int16Array([mem[0x4AD]])[0])) & (io_ports[0x3D4] & 1 ? 0xFF : 0xFF00)) >> (io_ports[0x3D4] & 1 ? 0 : 8)); // CRT cursor position
				R_M_OP('regs8[REG_AL]', '=', 'io_ports[scratch_uint]');
			;break; case 22: // OUT DX/imm8, AL/AX
				scratch_uint = extra ? regs16[REG_DX] : (new Uint8Array([i_data0])[0]);
				R_M_OP('io_ports[scratch_uint]', '=', 'regs8[REG_AL]');
				scratch_uint == 0x61 && (io_hi_lo = 0, spkr_en |= regs8[REG_AL] & 3); // Speaker control
				(scratch_uint == 0x40 || scratch_uint == 0x42) && (io_ports[0x43] & 6) && (mem[0x469 + scratch_uint - (io_hi_lo ^= 1)] = regs8[REG_AL]); // PIT rate programming
				scratch_uint == 0x3D5 && (io_ports[0x3D4] >> 1 == 6) && (mem[0x4AD + !(io_ports[0x3D4] & 1)] = regs8[REG_AL]); // CRT video RAM start offset
				scratch_uint == 0x3D5 && (io_ports[0x3D4] >> 1 == 7) && (scratch2_uint = ((mem[0x49E]*80 + mem[0x49D] + (new Int16Array([mem[0x4AD]])[0])) & (io_ports[0x3D4] & 1 ? 0xFF00 : 0xFF)) + (regs8[REG_AL] << (io_ports[0x3D4] & 1 ? 0 : 8)) - (new Int8Array([mem[0x4AD]])[0]), mem[0x49D] = scratch2_uint % 80, mem[0x49E] = Math.floor(scratch2_uint / 80)); // CRT cursor position
				scratch_uint == 0x3B5 && io_ports[0x3B4] == 1 && (GRAPHICS_X = regs8[REG_AL] * 16); // Hercules resolution reprogramming. Defaults are set in the BIOS
				scratch_uint == 0x3B5 && io_ports[0x3B4] == 6 && (GRAPHICS_Y = regs8[REG_AL] * 4);
			;break; case 23: // REPxx
				rep_override_en = 2;
				rep_mode = i_w;
				seg_override_en && seg_override_en++
			;break; case 25: // PUSH reg
				R_M_PUSH('regs16[extra]')
			;break; case 26: // POP reg
				R_M_POP('regs16[extra]')
			;break; case 27: // xS: segment overrides
				seg_override_en = 2;
				seg_override = extra;
				rep_override_en && rep_override_en++
			;break; case 28: // DAA/DAS
				i_w = 0;
				extra ? DAA_DAS('-=', '>=', '0xFF', '0x99') : DAA_DAS('+=', '<', '0xF0', '0x90') // extra = 0 for DAA, 1 for DAS
			;break; case 29: // AAA/AAS
				op_result = AAA_AAS(extra - 1)
			;break; case 30: // CBW
				regs8[REG_AH] = -SIGN_OF('regs8[REG_AL]')
			;break; case 31: // CWD
				regs16[REG_DX] = -SIGN_OF('regs16[REG_AX]')
			;break; case 32: // CALL FAR imm16:imm16
				R_M_PUSH('regs16[REG_CS]');
				R_M_PUSH('reg_ip + 5');
				regs16[REG_CS] = i_data2;
				reg_ip = i_data0
			;break; case 33: // PUSHF
				make_flags();
				R_M_PUSH('scratch_uint')
			;break; case 34: // POPF
				set_flags(R_M_POP('scratch_uint'))
			;break; case 35: // SAHF
				make_flags();
				set_flags((scratch_uint & 0xFF00) + regs8[REG_AH])
			;break; case 36: // LAHF
				make_flags(),
				regs8[REG_AH] = scratch_uint
			;break; case 37: // LES|LDS reg, r/m
				i_w = i_d = 1;
				DECODE_RM_REG();
				OP('=');
				MEM_OP('REGS_BASE + extra', '=', 'rm_addr + 2')
			;break; case 38: // INT 3
				++reg_ip;
				pc_interrupt(3)
			;break; case 39: // INT imm8
				reg_ip += 2;
				pc_interrupt(i_data0)
			;break; case 40: // INTO
				++reg_ip;
				regs8[FLAG_OF] && pc_interrupt(4)
			;break; case 41: // AAM
				if (i_data0 &= 0xFF)
					regs8[REG_AH] = regs8[REG_AL] / i_data0,
					op_result = regs8[REG_AL] %= i_data0;
				else // Divide by zero
					pc_interrupt(0)
			;break; case 42: // AAD
				i_w = 0;
				regs16[REG_AX] = op_result = 0xFF & regs8[REG_AL] + i_data0 * regs8[REG_AH]
			;break; case 43: // SALC
				regs8[REG_AL] = -regs8[FLAG_CF]
			;break; case 44: // XLAT
				regs8[REG_AL] = mem[SEGREG('seg_override_en ? seg_override : REG_DS', 'REG_BX', 'regs8[REG_AL] +')]
			;break; case 45: // CMC
				regs8[FLAG_CF] ^= 1
			;break; case 46: // CLC|STC|CLI|STI|CLD|STD
				regs8[extra / 2] = extra & 1
			;break; case 47: // TEST AL/AX, immed
				R_M_OP('regs8[REG_AL]','&', 'i_data0')
			;break; case 48: // Emulator-specific 0F xx opcodes
				switch (new Int8Array([i_data0])[0])
				{
					case 0: // PUTCHAR_AL
						console.log(String.fromCharCode(regs8[REG_AL]));
						break;
					case 1: // GET_RTC
						mem[SEGREG('REG_ES', 'REG_BX', '36+')] = new Int16Array([Date.now()])[0];
						let time = localtime();
						let offset = SEGREG("REG_ES", "REG_BX", "");
						for (let index = 0; index < 40; index++) {
							mem[offset + index] = time[index];
						}
						break; 
					case 2: // DISK_READ
						break;
					case 3: // DISK_WRITE
						/* regs8[REG_AL] = ~lseek(disk[regs8[REG_DL]], CAST(unsigned)regs16[REG_BP] << 9, 0)
							? ((char)i_data0 == 3 ? (int(*)())write : (int(*)())read)(disk[regs8[REG_DL]], mem + SEGREG(REG_ES, REG_BX,), regs16[REG_AX])
							: 0; */
						console.warn("DISK_WRITE unimplemented");
						regs8[REG_AL] = 0;
						break;
				}
		}

		// Increment instruction pointer by computed instruction length. Tables in the BIOS binary
		// help us here.
		reg_ip += (i_mod*(i_mod != 3) + 2*(!i_mod && i_rm == 6))*i_mod_size + bios_table_lookup[TABLE_BASE_INST_SIZE][raw_opcode_id] + bios_table_lookup[TABLE_I_W_SIZE][raw_opcode_id]*(i_w + 1);

		// If instruction needs to update SF, ZF and PF, set them as appropriate
		if (set_flags_type & FLAGS_UPDATE_SZP)
		{
			regs8[FLAG_SF] = SIGN_OF(op_result);
			regs8[FLAG_ZF] = !op_result;
			regs8[FLAG_PF] = bios_table_lookup[TABLE_PARITY_FLAG][new Uint8Array([op_result])[0]];

			// If instruction is an arithmetic or logic operation, also set AF/OF/CF as appropriate.
			if (set_flags_type & FLAGS_UPDATE_AO_ARITH)
				set_AF_OF_arith();
			if (set_flags_type & FLAGS_UPDATE_OC_LOGIC)
				set_CF(0), set_OF(0);
		}

		// Poll timer/keyboard every KEYBOARD_TIMER_UPDATE_DELAY instructions
		if (!(++inst_counter % KEYBOARD_TIMER_UPDATE_DELAY))
			int8_asap = 1;


		// Application has set trap flag, so fire INT 1
		if (trap_flag)
			pc_interrupt(1);

		trap_flag = regs8[FLAG_TF];

		// If a timer tick is pending, interrupts are enabled, and no overrides/REP are active,
		// then process the tick and check for new keystrokes
		if (int8_asap && !seg_override_en && !rep_override_en && regs8[FLAG_IF] && !regs8[FLAG_TF])
			pc_interrupt(0xA), int8_asap = 0, SDL_KEYBOARD_DRIVER;
	}
	return 0;
}
O_LOG = true;
$_LOG = false;
main();
