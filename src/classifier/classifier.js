export default varDump;

// debug helper in honor of PHP's var_dump. We don't recursively print nested data types tho.
function varDump(some_value, description='') {
    console.log(description + ' -> typeof: ' + typeof some_value);
    console.log(some_value);
}
